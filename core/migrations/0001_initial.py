from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Entity",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("kind", models.CharField(db_index=True, max_length=64)),
                ("external_id", models.CharField(db_index=True, max_length=160)),
                ("data", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.AlterUniqueTogether(name="entity", unique_together={("kind", "external_id")}),
        migrations.AddIndex(model_name="entity", index=models.Index(fields=["kind", "external_id"], name="core_entity_kind_4fdd6c_idx")),
    ]
