import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from core.models import Entity


class Command(BaseCommand):
    help = "Import the existing data/db.json state into the Django SQLite entity table."

    def add_arguments(self, parser):
        parser.add_argument("--path", default=str(settings.BASE_DIR / "data" / "db.json"))
        parser.add_argument("--clear", action="store_true")

    def handle(self, *args, **options):
        path = Path(options["path"])
        if not path.exists():
            self.stderr.write(f"Missing JSON file: {path}")
            return

        if options["clear"]:
            Entity.objects.exclude(kind="sessions").delete()

        data = json.loads(path.read_text(encoding="utf-8"))
        imported = 0
        for kind, rows in data.items():
            if kind == "settings" or not isinstance(rows, list):
                continue
            for index, row in enumerate(rows):
                if not isinstance(row, dict):
                    continue
                external_id = row.get("id") or f"{kind}-{index + 1}"
                row["id"] = external_id
                Entity.objects.update_or_create(
                    kind=kind,
                    external_id=external_id,
                    defaults={"data": row},
                )
                imported += 1

        self.stdout.write(self.style.SUCCESS(f"Imported {imported} records from {path.name}"))
