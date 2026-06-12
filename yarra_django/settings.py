import os
import tempfile
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent

env_path = BASE_DIR / ".env"
if env_path.exists():
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

IS_VERCEL = bool(os.environ.get("VERCEL"))
DEFAULT_RUNTIME_ROOT = Path(tempfile.gettempdir()) if IS_VERCEL else Path(os.environ.get("LOCALAPPDATA", BASE_DIR / "data"))
RUNTIME_DIR = Path(os.environ.get("YARRA_RUNTIME_DIR") or DEFAULT_RUNTIME_ROOT / "Yarra")
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "local-dev-yarra-django")
DEBUG = os.environ.get("DJANGO_DEBUG", "false" if IS_VERCEL else "true").lower() == "true"
ALLOWED_HOSTS = [
    "127.0.0.1",
    "localhost",
    ".vercel.app",
    *(host for host in [os.environ.get("VERCEL_URL")] if host),
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "yarra_django.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "yarra_django.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": RUNTIME_DIR / "yarra.sqlite3",
    }
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "assets/"
STATICFILES_DIRS = [BASE_DIR / "assets"]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
UPI_PAYEE_ID = os.environ.get("UPI_PAYEE_ID", "vishnuaravindhr-1@okicici")
UPI_PAYEE_NAME = os.environ.get("UPI_PAYEE_NAME", "Yarra Education Group")
