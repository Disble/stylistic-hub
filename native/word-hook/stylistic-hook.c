// Loaded into Word by WH_CBT thread hooks only while the hub shows Word its trigger document. Word does not
// create a window for a new document: it shows a hidden frame it keeps ready. While the hub's named event exists
// and is set, this subclasses Word's hidden frames so that the one Word shows for the trigger stays off screen,
// is never maximized and has no taskbar button. Once the event is gone or reset, every subclassed frame is
// restored on its next message, so the user's own documents are never affected.
#include <windows.h>

#define MAX_FRAMES 16
#define OFF_SCREEN (-32000)
#define TRIGGER_EVENT L"Local\\StylisticHubTrigger"

typedef struct {
  HWND hwnd;
  WNDPROC original;
  LONG_PTR exstyle;
} Frame;

static Frame frames[MAX_FRAMES];
static volatile LONG scanned;

// True only while the hub holds its event and has set it; opened each time so a hub that died stops it.
static BOOL trigger_active(void) {
  HANDLE event = OpenEventW(SYNCHRONIZE, FALSE, TRIGGER_EVENT);
  if (!event) return FALSE;
  BOOL active = WaitForSingleObject(event, 0) == WAIT_OBJECT_0;
  CloseHandle(event);
  return active;
}

static Frame *find(HWND hwnd) {
  for (int i = 0; i < MAX_FRAMES; i++)
    if (frames[i].hwnd == hwnd) return &frames[i];
  return NULL;
}

static LRESULT CALLBACK keep_off_screen(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam);

static void restore(Frame *frame) {
  if ((WNDPROC)GetWindowLongPtrW(frame->hwnd, GWLP_WNDPROC) == keep_off_screen)
    SetWindowLongPtrW(frame->hwnd, GWLP_WNDPROC, (LONG_PTR)frame->original);
  SetWindowLongPtrW(frame->hwnd, GWL_EXSTYLE, frame->exstyle);
  frame->hwnd = NULL;
}

static LRESULT CALLBACK keep_off_screen(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
  Frame *frame = find(hwnd);
  if (!frame) return DefWindowProcW(hwnd, msg, wparam, lparam);
  WNDPROC original = frame->original;
  if (msg == WM_NCDESTROY || !trigger_active()) {
    restore(frame);
  } else if (msg == WM_WINDOWPOSCHANGING) {
    WINDOWPOS *pos = (WINDOWPOS *)lparam;
    pos->x = OFF_SCREEN;
    pos->y = OFF_SCREEN;
    pos->flags &= ~SWP_NOMOVE;
  }
  return CallWindowProcW(original, hwnd, msg, wparam, lparam);
}

static BOOL CALLBACK adopt_hidden_frame(HWND hwnd, LPARAM unused) {
  (void)unused;
  DWORD pid;
  WCHAR cls[16];
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid != GetCurrentProcessId() || IsWindowVisible(hwnd) || find(hwnd)) return TRUE;
  if (!GetClassNameW(hwnd, cls, 16) || lstrcmpW(cls, L"OpusApp") != 0) return TRUE;
  Frame *frame = find(NULL);
  if (!frame) return FALSE;
  frame->hwnd = hwnd;
  frame->exstyle = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (frame->exstyle | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW);
  frame->original = (WNDPROC)SetWindowLongPtrW(hwnd, GWLP_WNDPROC, (LONG_PTR)keep_off_screen);
  return TRUE;
}

__declspec(dllexport) LRESULT CALLBACK StylisticCbtProc(int code, WPARAM wparam, LPARAM lparam) {
  if (code >= 0) {
    if (trigger_active()) {
      if (InterlockedCompareExchange(&scanned, 1, 0) == 0) EnumWindows(adopt_hidden_frame, 0);
      // Keep the user's window active while Word loads the trigger.
      if (code == HCBT_ACTIVATE && find((HWND)wparam)) return 1;
      if (code == HCBT_MINMAX && find((HWND)wparam)) {
        int show = LOWORD(lparam);
        if (show == SW_MAXIMIZE || show == SW_SHOWMAXIMIZED) return 1;
      }
    } else {
      InterlockedExchange(&scanned, 0);
    }
  }
  return CallNextHookEx(NULL, code, wparam, lparam);
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) {
  (void)instance;
  (void)reserved;
  if (reason == DLL_PROCESS_ATTACH) {
    // Stay loaded: Windows may unload a hook DLL once the hook is removed, and a frame still subclassed to it
    // would then call into freed memory.
    HMODULE self;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
                       (LPCWSTR)(void *)&DllMain, &self);
  }
  return TRUE;
}
