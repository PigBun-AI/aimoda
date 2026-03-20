from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    ENV: str = "development"
    PORT: int = 3000
    JWT_SECRET: str
    FRONTEND_URL: str = "http://localhost"
    SERVER_URL: str | None = None
    REPORTS_DIR: str = "/reports"
    DATABASE_PATH: str = "/data/fashion-report.db"
    ACCESS_TOKEN_EXPIRES_IN: str = "2h"
    REFRESH_TOKEN_EXPIRES_IN: str = "7d"
    UPLOAD_TMP_DIR: str = "/tmp/fashion-report-uploads"

    # --- Agent / Chat ---
    QDRANT_URL: str = "http://202.104.119.31:16333"
    QDRANT_API_KEY: str
    QDRANT_COLLECTION: str = "fashion_items"

    LLM_MODEL: str = "MiniMax-M2.5-highspeed"
    LLM_API_KEY: str
    LLM_BASE_URL: str = "https://api.minimaxi.com/anthropic"
    LLM_TEMPERATURE: float = 0.1
    LLM_MAX_TOKENS: int = 4096

    EMBEDDING_URL: str = "http://183.62.232.22:18730"
    EMBEDDING_MODEL: str = "Marqo/marqo-fashionSigLIP"

    POSTGRES_DSN: str = "postgresql://fashion:fashion@postgres:5432/fashion_chat"
    REDIS_DSN: str = "redis://redis:6379/0"

    # Aliyun OSS
    OSS_ACCESS_KEY_ID: str = ""
    OSS_ACCESS_KEY_SECRET: str = ""
    OSS_BUCKET_NAME: str = ""
    OSS_ENDPOINT: str = "oss-cn-hangzhou.aliyuncs.com"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def resolved_reports_dir(self) -> Path:
        return Path(self.REPORTS_DIR).resolve()

    @property
    def resolved_database_path(self) -> Path:
        return Path(self.DATABASE_PATH).resolve()

    @property
    def resolved_upload_tmp_dir(self) -> Path:
        return Path(self.UPLOAD_TMP_DIR).resolve()


settings = Settings()
