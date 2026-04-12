import os
from pathlib import Path
from pydantic_settings import BaseSettings


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_ENV_FILE = ROOT_DIR / "env" / "dev.env"
ENV_FILE = os.getenv("AIMODA_ENV_FILE", str(DEFAULT_ENV_FILE))


class Settings(BaseSettings):
    ENV: str = "development"
    APP_TIMEZONE: str = "Asia/Shanghai"
    PORT: int = 3000
    JWT_SECRET: str
    FRONTEND_URL: str = "http://localhost"
    SERVER_URL: str | None = None
    REPORTS_DIR: str = "/reports"
    DATABASE_PATH: str = "/data/fashion-report.db"
    ACCESS_TOKEN_EXPIRES_IN: str = "2h"
    REFRESH_TOKEN_EXPIRES_IN: str = "7d"
    AUTH_REFRESH_COOKIE_NAME: str = "aimoda_refresh_token"
    UPLOAD_TMP_DIR: str = "/tmp/fashion-report-uploads"
    REPORT_MCP_INTERNAL_TOKEN: str = "aimoda-report-mcp-internal-token"
    REPORT_MCP_SERVICE_USER_ID: int = 1

    # --- Agent / Chat ---
    QDRANT_URL: str = "http://220.168.84.134:16333"
    QDRANT_API_KEY: str
    QDRANT_COLLECTION: str = "fashion_items"

    LLM_PROVIDER: str = "openai"
    LLM_MODEL: str = "qwen3.5-flash"
    LLM_API_KEY: str
    LLM_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    LLM_TEMPERATURE: float = 0.1
    LLM_MAX_TOKENS: int = 32768
    LLM_THINKING_ENABLED: bool = False
    AGENT_RUNTIME_HARNESS_ENABLED: bool = True
    AGENT_RUNTIME_HARNESS_MAX_SAME_ERROR_RETRIES: int = 1
    FALLBACK_LLM_ENABLED: bool = True
    FALLBACK_LLM_PROVIDER: str = "anthropic"
    FALLBACK_LLM_MODEL: str = "MiniMax-M2.7-highspeed"
    FALLBACK_LLM_API_KEY: str = ""
    FALLBACK_LLM_BASE_URL: str = "https://api.minimaxi.com/anthropic"
    FALLBACK_LLM_THINKING_ENABLED: bool = False

    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    VLM_MODEL: str = "qwen3.5-flash"
    VLM_TEMPERATURE: float = 0.1
    VLM_MAX_TOKENS: int = 1200
    VLM_TIMEOUT_SECONDS: float = 45.0
    REF_ENRICHMENT_TIMEOUT_SECONDS: float = 300.0

    EMBEDDING_URL: str = "http://183.62.232.22:18730"
    EMBEDDING_MODEL: str = "Marqo/marqo-fashionSigLIP"
    STYLE_KNOWLEDGE_COLLECTION: str = "style_knowledge"
    STYLE_KNOWLEDGE_EMBEDDING_URL: str = "http://183.62.232.22:18730"
    STYLE_KNOWLEDGE_EMBEDDING_MODEL: str = "infgrad/stella-mrl-large-zh-v3.5-1792d"
    STYLE_KNOWLEDGE_SEMANTIC_SCORE_THRESHOLD: float = 0.5
    STYLE_KNOWLEDGE_LOW_SCORE_FALLBACK_THRESHOLD: float = 0.75

    POSTGRES_DSN: str = "postgresql://fashion:fashion@postgres:5432/fashion_chat"
    REDIS_DSN: str = "redis://redis:6379/0"

    # Aliyun OSS
    OSS_ACCESS_KEY_ID: str = ""
    OSS_ACCESS_KEY_SECRET: str = ""
    OSS_BUCKET_NAME: str = ""
    OSS_ENDPOINT: str = "oss-cn-hangzhou.aliyuncs.com"
    OSS_PUBLIC_BASE: str | None = None
    OSS_USE_HTTPS: bool = True
    OSS_CORS_ALLOWED_ORIGINS: str = "*"
    OSS_CORS_ALLOWED_METHODS: str = "GET,HEAD,PUT,POST"
    OSS_CORS_ALLOWED_HEADERS: str = "*"
    OSS_CORS_EXPOSE_HEADERS: str = "ETag,x-oss-request-id"
    OSS_CORS_MAX_AGE_SECONDS: int = 86400
    REPORT_PREVIEW_TOKEN_TTL_SECONDS: int = 900

    # SMS auth
    SMS_PROVIDER: str = "mock"
    SMS_CODE_TTL_SECONDS: int = 300
    SMS_RESEND_INTERVAL_SECONDS: int = 60
    SMS_DAILY_SEND_LIMIT: int = 20
    SMS_MOCK_CODE: str = "123456"
    FAVORITE_UPLOAD_JOB_STALE_SECONDS: int = 1800
    ALIYUN_SMS_ACCESS_KEY_ID: str = ""
    ALIYUN_SMS_ACCESS_KEY_SECRET: str = ""
    ALIYUN_SMS_ENDPOINT: str = "dysmsapi.aliyuncs.com"
    ALIYUN_SMS_SIGN_NAME: str = "深圳市像素澎湃科技"
    ALIYUN_SMS_TEMPLATE_CODE: str = "SMS_498250051"

    model_config = {
        "env_file": ENV_FILE,
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

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
