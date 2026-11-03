import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///namjai.db")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "dev-admin")
SILENT_AFTER_H = float(os.getenv("CLIP_SILENT_AFTER_H", "2"))
EVAL_EVERY_S = int(os.getenv("EVAL_EVERY_S", "600"))
