from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve
from django.conf import settings

from core import views


urlpatterns = [
    path("", views.index, name="index"),
    path("api/", include("core.urls")),
    path("admin/", admin.site.urls),
    re_path(r"^(?P<path>script\.js|styles\.css)$", serve, {"document_root": settings.BASE_DIR}),
    re_path(r"^assets/(?P<path>.*)$", serve, {"document_root": settings.BASE_DIR / "assets"}),
]
