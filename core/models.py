from django.db import models


class Entity(models.Model):
    kind = models.CharField(max_length=64, db_index=True)
    external_id = models.CharField(max_length=160, db_index=True)
    data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("kind", "external_id")
        indexes = [models.Index(fields=["kind", "external_id"])]

    def __str__(self):
        return f"{self.kind}:{self.external_id}"
