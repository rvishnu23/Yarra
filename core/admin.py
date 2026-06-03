from django.contrib import admin

from .models import Entity


@admin.register(Entity)
class EntityAdmin(admin.ModelAdmin):
    list_display = ("kind", "external_id", "updated_at")
    list_filter = ("kind",)
    search_fields = ("external_id",)
