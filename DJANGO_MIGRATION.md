# Django Migration

The Django version runs beside the original Node server so the app can be migrated safely.

## Runtime

Django stores its SQLite database outside OneDrive at:

```text
%LOCALAPPDATA%\Yarra\yarra.sqlite3
```

This avoids the OneDrive file-locking issues seen with JSON writes.

## Setup

```powershell
python -B manage.py migrate
python -B manage.py import_json --clear
```

## Run

```powershell
python -B scripts\django-server.py
```

Then open:

```text
http://127.0.0.1:4174/
```

## Notes

- The existing `index.html`, `styles.css`, `script.js`, and `assets/` are reused.
- Current `data/db.json` records are imported into Django's SQLite database.
- The Django API keeps the same `/api/...` paths where possible so the current UI can keep working during migration.
- The original Node server can still run on `4173`; Django runs on `4174`.
