// Loaded into Word by WH_CBT thread hooks only while the hub shows Word its trigger document. Word either shows a
// frame it keeps ready and hidden, or creates one for the document it is about to show; from outside its process
// neither can be kept out of sight (screen measured: 33-77 % of the pixels change). While the hub's named event
// exists and is set, this subclasses Word's hidden frames, every frame Word creates meanwhile (correcting the
// CREATESTRUCT before that window exists) and every frame Word shows for the first time, so the window Word shows
// for the trigger stays off screen, is never maximized or activated and has no taskbar button. A frame the user can
// see is never touched. Once the event is gone or reset, every subclassed frame is restored on its next message, so
// the user's own documents are never affected (docs/architecture.md).
#include <windows.h>
#include <tlhelp32.h>

#define MAX_FRAMES 16
#define MAX_THREADS 256
#define MAX_PROTECTED 16
#define OFF_SCREEN (-32000)
#define TRIGGER_EVENT L"Local\\StylisticHubTrigger"
// Set only while the loader is inside the call that makes Word create the trigger's document window: it bounds the
// one moment where a frame Word creates cannot be told apart from a window the user opens during the trigger.
#define TRIGGER_CALL_EVENT L"Local\\StylisticHubTriggerCall"
// A load raises hundreds of CBT events from several threads; the frames Word reuses and the threads it may create a
// window on are looked for at most this often.
#define SWEEP_INTERVAL_MS 50
#define THREAD_INTERVAL_MS 5

#ifdef STYLISTIC_HOOK_TRACE
#include <stdarg.h>
static DWORD started;
// Diagnostic build only (bun scripts/build-word-hook.ts --trace): appends to %TEMP%\stylistic-hook.log. It writes
// that file synchronously from a few paths that hold the hook's lock, so a trace build can be delayed by file I/O
// (never a message send, and never a shipped build: `bun run dist` compiles this file without the define).
static void trace(const char *fmt, ...) {
  char line[256], path[MAX_PATH];
  va_list args;
  va_start(args, fmt);
  int n = wvsprintfA(line, fmt, args);
  va_end(args);
  if (!GetEnvironmentVariableA("TEMP", path, MAX_PATH)) return;
  lstrcatA(path, "\\stylistic-hook.log");
  HANDLE file = CreateFileA(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_ALWAYS, 0, NULL);
  if (file == INVALID_HANDLE_VALUE) return;
  char stamp[32];
  int s = wsprintfA(stamp, "[%lu] ", GetTickCount() - started);
  DWORD written;
  WriteFile(file, stamp, s, &written, NULL);
  WriteFile(file, line, n, &written, NULL);
  WriteFile(file, "\r\n", 2, &written, NULL);
  CloseHandle(file);
}
#else
#define trace(...) ((void)0)
#endif

__declspec(dllexport) LRESULT CALLBACK StylisticCbtProc(int code, WPARAM wparam, LPARAM lparam);

typedef struct {
  HWND hwnd;
  WNDPROC original;
  LONG_PTR exstyle;
} Frame;

static Frame frames[MAX_FRAMES];
// The frames the user could see when the hook was armed: their windows, never touched.
static HWND protected_frames[MAX_PROTECTED];
typedef struct {
  DWORD thread;
  HHOOK hook;
} HookedThread;

static HookedThread hooked[MAX_THREADS];
static CRITICAL_SECTION lock;
static volatile LONG last_sweep;
static volatile LONG last_threads;
static volatile LONG armed;
static HINSTANCE self;

// True only while name exists and is set; opened each time so a loader that died stops it.
static BOOL event_active(LPCWSTR name) {
  HANDLE event = OpenEventW(SYNCHRONIZE, FALSE, name);
  if (!event) return FALSE;
  BOOL active = WaitForSingleObject(event, 0) == WAIT_OBJECT_0;
  CloseHandle(event);
  return active;
}

static BOOL trigger_active(void) {
  return event_active(TRIGGER_EVENT);
}

// Callers hold the lock.
static Frame *find(HWND hwnd) {
  for (int i = 0; i < MAX_FRAMES; i++)
    if (frames[i].hwnd == hwnd) return &frames[i];
  return NULL;
}

static BOOL has_class(HWND hwnd, LPCWSTR wanted) {
  WCHAR cls[16];
  return GetClassNameW(hwnd, cls, 16) && lstrcmpW(cls, wanted) == 0;
}

static BOOL is_frame(HWND hwnd) {
  return has_class(hwnd, L"OpusApp");
}

// A frame that is already showing a document (_WwG) is the user's own window and is left alone; the frames Word
// shows for the trigger are empty when they appear. The caller holds the lock.
static BOOL CALLBACK find_document(HWND hwnd, LPARAM found) {
  if (has_class(hwnd, L"_WwG")) {
    *(BOOL *)found = TRUE;
    return FALSE;
  }
  return TRUE;
}

static BOOL shows_document(HWND frame) {
  BOOL found = FALSE;
  EnumChildWindows(frame, find_document, (LPARAM)&found);
  return found;
}

static LRESULT CALLBACK keep_off_screen(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam);

// Subclasses a frame and remembers the extended style to give back; false when every slot is taken or the window is
// already adopted. The caller holds the lock.
static BOOL adopt(HWND hwnd, LONG_PTR exstyle) {
  Frame *frame = find(hwnd);
  if (frame) return TRUE;
  frame = find(NULL);
  if (!frame) return FALSE;
  frame->hwnd = hwnd;
  frame->exstyle = exstyle;
  frame->original = (WNDPROC)SetWindowLongPtrW(hwnd, GWLP_WNDPROC, (LONG_PTR)keep_off_screen);
  return TRUE;
}

// Remembers the frames the user can see, so they are never mistaken for one of Word's.
static BOOL CALLBACK protect_visible(HWND hwnd, LPARAM unused) {
  (void)unused;
  DWORD pid;
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid != GetCurrentProcessId() || !IsWindowVisible(hwnd) || !is_frame(hwnd)) return TRUE;
  for (int i = 0; i < MAX_PROTECTED; i++) {
    if (protected_frames[i] == hwnd) return TRUE;
    if (!protected_frames[i]) {
      protected_frames[i] = hwnd;
      trace("protecting %p, Word's own window", hwnd);
      return TRUE;
    }
  }
  return TRUE;
}

// The caller holds the lock.
static BOOL is_protected(HWND hwnd) {
  for (int i = 0; i < MAX_PROTECTED; i++)
    if (protected_frames[i] == hwnd) return TRUE;
  return FALSE;
}

// Gives a frame back to Word. The procedure swap does not send a message, but the extended-style write does
// (WM_STYLECHANGING), and by then the window procedure is Word's own again, so that write happens outside the lock.
// The caller does not hold the lock.
static void restore(HWND hwnd) {
  WNDPROC original = NULL;
  LONG_PTR exstyle = 0;
  BOOL ours = FALSE;
  EnterCriticalSection(&lock);
  Frame *frame = find(hwnd);
  if (frame) {
    ours = TRUE;
    original = frame->original;
    exstyle = frame->exstyle;
    if ((WNDPROC)GetWindowLongPtrW(hwnd, GWLP_WNDPROC) == keep_off_screen)
      SetWindowLongPtrW(hwnd, GWLP_WNDPROC, (LONG_PTR)original);
    frame->hwnd = NULL;
    frame->original = NULL;
  }
  LeaveCriticalSection(&lock);
  if (!ours) return;
  SetWindowLongPtrW(hwnd, GWL_EXSTYLE, exstyle);
  trace("restored %p", hwnd);
}

static LRESULT CALLBACK keep_off_screen(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
  WNDPROC original = NULL;
  BOOL ours = FALSE;
  BOOL release = FALSE;
  EnterCriticalSection(&lock);
  Frame *frame = find(hwnd);
  if (frame) {
    ours = TRUE;
    original = frame->original;
    release = msg == WM_NCDESTROY || !trigger_active();
  }
  LeaveCriticalSection(&lock);
  if (release) restore(hwnd);
  if (!ours) return DefWindowProcW(hwnd, msg, wparam, lparam);
  if (msg == WM_WINDOWPOSCHANGING) {
    WINDOWPOS *pos = (WINDOWPOS *)lparam;
    pos->x = OFF_SCREEN;
    pos->y = OFF_SCREEN;
    pos->flags &= ~SWP_NOMOVE;
    if (pos->flags & SWP_SHOWWINDOW) trace("shown off screen %p", hwnd);
  }
  return CallWindowProcW(original, hwnd, msg, wparam, lparam);
}

// A frame is adopted when it is hidden (the one Word keeps ready) or about to be placed (HCBT_MOVESIZE, which Word
// sends before the position change the window procedure below neutralizes). A frame the user can see is never
// adopted, and neither is one that is already showing a document: those are the user's windows, and the trigger's
// window is empty when it appears. The caller holds the lock.
static BOOL adopt_frame(HWND hwnd, LONG_PTR *exstyle) {
  if (!is_frame(hwnd) || is_protected(hwnd) || shows_document(hwnd)) return FALSE;
  *exstyle = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  if (!adopt(hwnd, *exstyle)) return FALSE;
  trace("adopted frame %p", hwnd);
  return TRUE;
}

// A frame Word shows for the trigger is not a taskbar window; this write sends WM_STYLECHANGING, so the caller does
// it outside the lock.
static void hide_from_taskbar(HWND hwnd, LONG_PTR exstyle) {
  SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (exstyle | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW);
}

// The frames the sweep adopted, collected on the sweep's own stack so their style can be applied once the lock is
// free: the style write sends WM_STYLECHANGING, and doing it under the lock could deadlock against the window
// procedure of a frame owned by another Word thread.
typedef struct {
  HWND hwnd[MAX_FRAMES];
  LONG_PTR exstyle[MAX_FRAMES];
  int count;
} Sweep;

static BOOL CALLBACK look_for_frames(HWND hwnd, LPARAM param) {
  Sweep *sweep = (Sweep *)param;
  DWORD pid;
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid == GetCurrentProcessId()) {
    EnterCriticalSection(&lock);
    LONG_PTR exstyle = 0;
    if (adopt_frame(hwnd, &exstyle) && sweep->count < MAX_FRAMES) {
      sweep->hwnd[sweep->count] = hwnd;
      sweep->exstyle[sweep->count] = exstyle;
      sweep->count++;
    }
    LeaveCriticalSection(&lock);
  }
  return TRUE;
}

// Word shows a document's window from a thread of its own, and it may create that thread after the hooks were set:
// every thread of this process gets the hook, so no window of it can be created or shown unwatched. The caller
// holds the lock.
static void hook_threads(void) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
  if (snapshot == INVALID_HANDLE_VALUE) return;
  DWORD self_pid = GetCurrentProcessId();
  THREADENTRY32 thread = {0};
  thread.dwSize = sizeof(thread);
  if (Thread32First(snapshot, &thread)) {
    do {
      if (thread.dwSize < FIELD_OFFSET(THREADENTRY32, th32OwnerProcessID) + sizeof(DWORD)) continue;
      if (thread.th32OwnerProcessID != self_pid) continue;
      BOOL known = FALSE;
      for (int i = 0; i < MAX_THREADS && !known; i++) known = hooked[i].thread == thread.th32ThreadID;
      if (known) continue;
      for (int i = 0; i < MAX_THREADS; i++) {
        if (hooked[i].thread) continue;
        HHOOK hook = SetWindowsHookExW(WH_CBT, (HOOKPROC)StylisticCbtProc, self, thread.th32ThreadID);
        if (hook) {
          hooked[i].thread = thread.th32ThreadID;
          hooked[i].hook = hook;
          trace("hooked thread %lu", thread.th32ThreadID);
        }
        break;
      }
    } while (Thread32Next(snapshot, &thread));
  }
  CloseHandle(snapshot);
}

// The loader unhooks the threads it hooked itself; the ones this DLL hooked while the trigger ran are released
// here, so no hook of ours outlives the trigger it was installed for. The caller holds the lock.
static void unhook_threads(void) {
  for (int i = 0; i < MAX_THREADS; i++) {
    if (!hooked[i].hook) continue;
    trace("unhooked thread %lu", hooked[i].thread);
    UnhookWindowsHookEx(hooked[i].hook);
    hooked[i].thread = 0;
    hooked[i].hook = NULL;
  }
}

__declspec(dllexport) LRESULT CALLBACK StylisticCbtProc(int code, WPARAM wparam, LPARAM lparam) {
  if (code >= 0) {
    if (trigger_active()) {
      DWORD now = GetTickCount();
      // Word creates the thread that shows the trigger's window while the trigger runs, so new threads are taken
      // much sooner than the frames Word keeps ready.
      if (now - (DWORD)InterlockedCompareExchange(&last_threads, (LONG)now, (LONG)last_threads) >= THREAD_INTERVAL_MS) {
        EnterCriticalSection(&lock);
        hook_threads();
        LeaveCriticalSection(&lock);
      }
      if (!InterlockedCompareExchange(&armed, 1, 0)) {
        // The windows the user can see right now are theirs; the ones Word shows from here on are not.
        EnterCriticalSection(&lock);
        EnumWindows(protect_visible, 0);
        LeaveCriticalSection(&lock);
      }
      if (now - (DWORD)InterlockedCompareExchange(&last_sweep, (LONG)now, (LONG)last_sweep) >= SWEEP_INTERVAL_MS) {
        Sweep sweep = {0};
        EnterCriticalSection(&lock);
        EnumWindows(look_for_frames, (LPARAM)&sweep);
        LeaveCriticalSection(&lock);
        for (int i = 0; i < sweep.count; i++) hide_from_taskbar(sweep.hwnd[i], sweep.exstyle[i]);
      }
      HWND hwnd = (HWND)wparam;
      if (code == HCBT_CREATEWND && event_active(TRIGGER_CALL_EVENT)) {
        // Word creates the window it shows for the trigger inside the loader's Documents.Add, and that window is
        // empty until its document loads; fixing its CREATESTRUCT is what keeps its first placement off screen.
        CREATESTRUCTW *create = ((CBT_CREATEWNDW *)lparam)->lpcs;
        if (create && is_frame(hwnd)) {
          EnterCriticalSection(&lock);
          if (!is_protected(hwnd)) {
            LONG_PTR exstyle = create->dwExStyle;
            if (adopt(hwnd, exstyle)) {
              // The window does not exist yet: correcting its CREATESTRUCT places it off screen and creates it
              // without a taskbar entry, so no style change (and no message) is needed afterwards.
              create->x = OFF_SCREEN;
              create->y = OFF_SCREEN;
              create->dwExStyle = (create->dwExStyle | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
              trace("adopted created frame %p", hwnd);
            }
          }
          LeaveCriticalSection(&lock);
        }
      } else if (code == HCBT_MOVESIZE) {
        // A window about to be moved or sized, which is how Word places the frame it shows for the trigger: adopt
        // it here so the position change that follows goes through keep_off_screen.
        LONG_PTR moved = 0;
        BOOL adopted = FALSE;
        EnterCriticalSection(&lock);
        adopted = adopt_frame(hwnd, &moved);
        LeaveCriticalSection(&lock);
        if (adopted) hide_from_taskbar(hwnd, moved);
      }
      // Keep the user's window active while Word loads the trigger.
      if (code == HCBT_ACTIVATE) {
        EnterCriticalSection(&lock);
        BOOL ours = find(hwnd) != NULL;
        LeaveCriticalSection(&lock);
        if (ours) return 1;
      }
      if (code == HCBT_MINMAX) {
        EnterCriticalSection(&lock);
        BOOL ours = find(hwnd) != NULL;
        LeaveCriticalSection(&lock);
        if (ours) {
          int show = LOWORD(lparam);
          if (show == SW_MAXIMIZE || show == SW_SHOWMAXIMIZED) return 1;
        }
      }
    } else {
      InterlockedExchange(&last_sweep, 0);
      InterlockedExchange(&last_threads, 0);
      if (InterlockedExchange(&armed, 0)) {
        EnterCriticalSection(&lock);
        for (int i = 0; i < MAX_PROTECTED; i++) protected_frames[i] = NULL;
        unhook_threads();
        LeaveCriticalSection(&lock);
      }
    }
  }
  return CallNextHookEx(NULL, code, wparam, lparam);
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) {
  (void)reserved;
  if (reason == DLL_PROCESS_ATTACH) {
    self = instance;
    InitializeCriticalSection(&lock);
#ifdef STYLISTIC_HOOK_TRACE
    started = GetTickCount();
#endif
    // Stay loaded: Windows may unload a hook DLL once the hook is removed, and a frame still subclassed to it
    // would then call into freed memory.
    HMODULE module;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
                       (LPCWSTR)(void *)&DllMain, &module);
  }
  return TRUE;
}
