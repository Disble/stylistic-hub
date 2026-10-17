# Cargar Stylistic en Word: qué se intentó, por qué falló y qué queda

La fase de pruebas de integración **Hub → Word** se cierra aquí. El hub carga la extensión en el Word del usuario y el usuario lo validó con su propio documento (`UTH SS - Sofia Arzallos.docx`, 18.161 palabras): grupo **Stylistic** en la pestaña Inicio y panel abierto. Lo único que no se consiguió —y ahora sabemos que por esta vía no se puede— es que no aparezca la segunda ventana de Word durante ~1 s. Este informe es el registro de todo lo que se intentó, con el número que lo descarta, para que nadie lo vuelva a intentar sin saber qué se midió.

Punto de referencia: tag `known-good/word-addin-loads` (en `5c2cb86`), instalador `release/StylisticHub-Setup-0.0.1.exe`, y la bitácora `odd/tasks/mvp.md` L34–L52.

## 1. La conclusión que cierra la fase

**Word arranca el runtime de un add-in sideloaded sólo para un documento cuya ventana ha mostrado.** Cualquier supresión de esa ventana detiene la carga, se haga desde dentro de Word o desde fuera de su proceso. Las dos mitades de S11 —cargar siempre, no mostrar ventana— son **mutuamente excluyentes por la vía del documento trigger**: con ocultamiento no hay extensión (medido), sin ocultamiento hay ~1 s de segunda ventana (medido). No es un defecto del código propio: es cómo Word carga un add-in registrado en `HKCU\...\Wef\Developer`.

## 2. Lo que se intentó, y el número que lo descarta

| # | Vía | Qué midió |
| --- | --- | --- |
| 1 | Documento invisible: `Documents.Add(..., Visible := $false)` | Sin ventana **y sin carga**: el add-in no arranca (L34). |
| 2 | Desde fuera de Word, desde el script del hub: `ScreenUpdating = $false`, mover la ventana fuera de pantalla, `WS_EX_LAYERED` con alfa 0, `SW_HIDE` desde un hook de WinEvent | Word re-muestra la ventana mientras termina de cargar; el cambio de píxeles en pantalla fue del **33–77 %** (L42, L45). |
| 3 | Hook `WH_CBT` **dentro** del proceso de Word (la línea nativa en C, `native/word-hook/`) | **Cinco builds** medidos uno por uno —el comprometido, sin el bloqueo de activación, sin el cambio de estilo, sin forzar la posición, y uno **inerte** cuyo procedimiento de hook retorna de inmediato—: en los cinco, **0 peticiones de la página** del add-in y **0 UI** en la ventana. Sin el DLL, la misma configuración cargó **3 de 3**. Retirado en `9fb8d06`. |
| 4 | Ocultar la ventana **desde el proceso del loader**, sin inyectar nada en Word (un hilo llamando `ShowWindow(SW_HIDE)` cada 5 ms sobre el handle de la ventana propia del trigger) | El destello bajó de 1400–4200 ms a **440–560 ms** y el add-in quedó **sin cargar** (`before=False loaded=False`) en las dos corridas. |
| 5 | La señal de carga que se usaba antes | **Falsa**: el panel `MsoWorkPane` con el nombre del add-in lo crea Word a partir del `word/webextensions/taskpanes.xml` **del propio documento trigger**, exista o no el add-in. El loader cantaba `loaded` con la pantalla del usuario vacía. |
| 6 | Búsquedas del orden correcto: trigger en la pantalla de inicio, esperar a que el usuario tenga un documento, `Documents.Add` frente a `Open` | Ninguna evita el destello: cuando el add-in carga, la ventana ya se mostró (L34, L45, L46). |
| 7 | Instalación automática por registro: `Wef\AutoInstallAddins` | Exige un *asset id* de Marketplace (`"AssetIds"="WA999999999"`), es decir una publicación previa (L52). |

La #3 y la #4 juntas son la prueba limpia de la conclusión de la sección 1: la segunda no mete una sola línea de código en Word y falla exactamente igual que la primera, así que el problema es el ocultamiento y no el mecanismo.

## 3. Errores de medición que hubo que corregir (y por qué importan)

Los tres primeros hicieron que durante horas midiera mi propio error creyendo medir el sistema:

- La sonda terminaba cada corrida con `Stop-Process` sobre **todo** Word con ventana: mataba el Word del usuario y dejaba a Word reabriendo el documento de prueba al arrancar (`HKCU\...\Word\Resiliency\DocumentRecovery`). Ahora cierra únicamente el Word que ella misma abrió, leyendo su objeto de ventana (`OBJID_NATIVEOM`) en lugar de `GetActiveObject`, que devuelve la instancia que se registró primero.
- Las corridas dejaban instancias de Word y documentos acumulados, y una instancia residual retiene la carpeta de WebView2 del runtime de add-ins, así que **la sesión siguiente no arranca el add-in**: el probe causaba el fallo que estaba midiendo.
- El loader llamaba a `Write-Log` antes de su definición, y PowerShell no eleva las funciones: moría al arrancar y **tres sesiones midieron eso**. Desde entonces toda medición va precedida de un smoke test de 5 s (con `-ParentPid` inexistente el loader registra y sale).
- El frame del trigger se contaba como «ventana de Word»: **Word titula "Word" la ventana de un documento que aún está cargando**. Lo corrigió el usuario con sus ojos; la medición lo daba como invisible.

## 4. El camino soportado y lo que costaría (resumen de L52, con fuentes)

- **Dinero: cero.** El FAQ del Marketplace publicador dice *"there's no cost to publish offers in Microsoft Marketplace"*; el 3 % es comisión de ofertas de pago, y la cuenta de Partner Center es gratuita.
- **El bloqueo es de arquitectura, no de dinero.** La página de validación de manifiestos dice que la comprobación de tienda *"allows developer information like localhost URLs"* **sólo en su forma de desarrollo**, mientras que `-p` ejecuta la *"production-level Microsoft 365 and Copilot store validation"*. Para publicar, el panel, los iconos y la página de comandos tienen que estar alojados públicamente por HTTPS: la UI **saldría de la máquina del usuario**, y un producto cuyo análisis corre local con las credenciales de Pi del usuario pasaría a ser un cascarón público hablando con `localhost` (CORS, y la CA local confiada por una página servida desde internet).
- **El despliegue centralizado** no es distribución pública: pide licencia elegible de Microsoft 365, inicio de sesión organizativo **con buzón de Exchange Online**, tenant de Entra ID, un administrador que introduzca la URL del manifiesto, y hasta 24 h en aparecer.

## 5. Lo que **no** se intentó

- **Un add-in COM/VSTO en lugar de un add-in web.** Se instala por usuario y carga con Word, sin documento trigger y por tanto sin segunda ventana; pero cambia el modelo entero (sin `office.js`, panel propio en WinForms/WPF) mientras el add-on del proyecto es web. No probado, y es la única alternativa conocida que ataca la causa en lugar del síntoma.
- **Publicar la página**: requiere el hosting público de la sección 4.

## 6. Qué se borró y qué queda

Borrado (todo sigue en la historia de git): `native/word-hook/` —el hook en C—, `resources/word/stylistic-hook.dll`, `scripts/build-word-hook.ts`, el script `word:hook`, el paso de compilación dentro de `dist`/`dist:dir`, el requisito de MinGW-w64 en `docs/development.md`, el parámetro muerto `-ReportAfter` del loader, y las sondas de diagnóstico de un solo uso (`ribbon.ps1`, `window-binding.ps1`).

Queda, y es lo aprobado:

- `resources/word/word-session.ps1`: un trigger por sesión de Word, el veredicto por la UI del add-in **en la ventana del usuario**, la razón exacta registrada cuando falla, reintento acotado, y nada dentro del proceso de Word.
- `resources/addin-shell/manifest.json` + `scripts/stage-prod-addin.ts`: la identidad que el hub envía (se retirará cuando el proyecto del add-on asuma su manifiesto).
- `scripts/word-probe/presence.ps1` (¿está la extensión en la ventana?), `journey.ps1` (¿cuánto tiempo se ve una ventana?), `cleanup.ps1` (no dejar procesos ni documentos atrás).

## 7. Cómo re-verificarlo

```bash
bun run check:word                                            # el loader parsea
powershell -File resources/word/word-session.ps1 -Document <Stylistic.docx> -ParentPid 999999 -LogFile /tmp/smoke.log   # arranca sin error
powershell -File scripts/word-probe/presence.ps1 -Loader resources/word/word-session.ps1 -Trigger <Stylistic.docx> -Seconds 40
```

`presence.ps1` imprime la presencia del add-in en la ventana, los archivos de WebView2 del hub y las conexiones a su puerto, con los otros add-ins del usuario como control (si aparecen ellos y Stylistic no, la ausencia es real). El loader deja su veredicto en `%APPDATA%\stylistic-hub\logs\word-session.log`. Antes de medir conviene cerrar el hub o suspender su loader, para que su propio trigger no entre en la medición.
