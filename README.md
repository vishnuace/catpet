# 🐱 CatPet — a pixel cat that lives on your desktop

A free, open desktop pet inspired by [Comnyang](https://comnyang.com/). A tiny
pixel cat sits on top of all your windows, follows your cursor with its eyes,
reacts when you pick it up, purrs when you pet it, and reminds you to stretch and
take Pomodoro breaks.

Built with [Electron](https://www.electronjs.org/) so it runs on **Windows**,
macOS and Linux.

---

## ⬇️ Just want to run it on Windows? (no coding needed)

1. Open the **`download/`** folder in this repo.
2. Download **`CatPet-Portable.exe`**.
3. Double-click it. That's it — the cat appears in the bottom-right corner.
   - It's a *portable* app: nothing is installed, no admin rights needed. Keep
     the file anywhere (Desktop, USB stick…) and run it any time.
   - To have it start automatically with Windows, press `Win + R`, type
     `shell:startup`, press Enter, and drop a shortcut to the `.exe` in that
     folder.

> Windows SmartScreen may show "Windows protected your PC" because the app is not
> code-signed. Click **More info → Run anyway**. (This is normal for free,
> unsigned apps.)

---

## 🐾 What the cat does

| Interaction | The cat… |
|---|---|
| Move your mouse | follows the cursor with its eyes and leans toward it |
| Move the mouse fast near it | crouches and "hunts" the cursor, pupils dilate |
| Wave the mouse around wildly | overheats — turns red with steam puffing up |
| Click & drag it | gets picked up and stretches like mochi, legs dangle |
| Hover slowly over its head | gets petted — closes its eyes, purrs, hearts float up |
| Leave it alone | breathes, blinks, swishes its tail, then falls asleep (z z z) |
| Right-click it | opens a quick menu (hide / stretch / Pomodoro / settings / quit) |
| Double-click it | opens **Settings** |

### 🎬 Hide it instantly (movies / games / calls)

Press **`Ctrl + Alt + C`** anywhere to hide the cat, and press it again to bring
it back. The shortcut works globally even while you're in a fullscreen video or
game. You can also hide/show from the **tray icon** menu or the **Settings**
window, and you can change the shortcut (or disable it) under
**Settings → Hide / Show**. The cat remembers whether it was hidden the next time
you launch it.

Plus, from the tray icon (bottom-right of the taskbar) or Settings:

- **Customise the cat** — coat colour, pattern colour, belly, eye colour, and
  pattern style (solid / tabby / tuxedo / calico). There are quick presets too.
- **Stretch reminders** — a friendly nudge every N minutes; the cat stretches
  with you.
- **Pomodoro timer** — focus/break loop with a little pixel timer floating next
  to the cat.
- **Tell it your name** — it greets you in reminders.
- **Hide/show shortcut** — a global hotkey (default `Ctrl+Alt+C`) to hide the cat
  for movies/games and bring it back instantly.
- **Always on top**, **eyes follow cursor**, and other toggles.

Everything is saved automatically between launches. No accounts, no telemetry.

---

## 🛠️ Build it yourself

You need [Node.js](https://nodejs.org/) 18+ installed.

```bash
# install dependencies
npm install

# run the app in dev
npm start
```

### Make the Windows `.exe`

On **Windows** (easiest — produces installer + portable):

```bash
npm run dist:win
```

The finished files land in the `dist/` folder:

- `CatPet Setup x.y.z.exe` — installer
- `CatPet-Portable-x.y.z.exe` — portable, no install

> Building Windows binaries on **Linux/macOS** is also possible but requires
> `wine` (electron-builder uses it to stamp the icon into the `.exe`). On a
> Debian/Ubuntu machine: `sudo apt-get install -y wine wine32:i386`.

### Other platforms

```bash
npm run dist        # build for the OS you're currently on (mac/linux)
```

---

## 🤖 Automated builds (GitHub Actions)

This repo includes `.github/workflows/build-windows.yml`. Every push (and every
release tag) builds fresh Windows binaries on a real Windows runner and uploads
them as downloadable **artifacts**. If you fork/clone, your own builds appear
under the repo's **Actions** tab.

---

## 📁 Project layout

```
src/
  main.js              Electron main process: windows, tray, timers, IPC
  preload.js           safe bridge for the cat window
  settings-preload.js  safe bridge for the settings window
  cat.html/css/js      the desktop cat (canvas pixel-art renderer)
  settings.html/css/js the settings UI
  store.js             tiny JSON settings persistence
scripts/gen-icon.js    generates build/icon.png (no dependencies)
build/icon.png         app icon
download/              prebuilt portable .exe for non-technical users
```

## License

MIT — do whatever you like. Not affiliated with Comnyang.
