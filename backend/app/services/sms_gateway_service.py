from __future__ import annotations

import json
import logging
from typing import Any

from ..config import settings
from ..exceptions import AppError

logger = logging.getLogger(__name__)


class SmsGatewayError(Exception):
    def __init__(self, message: str, *, code: str | None = None, request_id: str | None = None):
        super().__init__(message)
        self.code = code
        self.request_id = request_id


def _send_with_aliyun(phone: str, code: str, expire_minutes: int) -> dict[str, Any]:
    try:
        from alibabacloud_dysmsapi20170525 import models as dysmsapi_models
        from alibabacloud_dysmsapi20170525.client import Client as DysmsapiClient
        from alibabacloud_tea_openapi import models as open_api_models
        from alibabacloud_tea_util import models as util_models
    except ImportError as exc:
        raise SmsGatewayError("阿里云短信依赖未安装") from exc

    if not settings.ALIYUN_SMS_ACCESS_KEY_ID or not settings.ALIYUN_SMS_ACCESS_KEY_SECRET:
        raise SmsGatewayError("阿里云短信 AccessKey 未配置")
    if not settings.ALIYUN_SMS_SIGN_NAME or not settings.ALIYUN_SMS_TEMPLATE_CODE:
        raise SmsGatewayError("阿里云短信签名或模板未配置")

    config = open_api_models.Config(
        access_key_id=settings.ALIYUN_SMS_ACCESS_KEY_ID,
        access_key_secret=settings.ALIYUN_SMS_ACCESS_KEY_SECRET,
    )
    config.endpoint = settings.ALIYUN_SMS_ENDPOINT

    client = DysmsapiClient(config)
    request = dysmsapi_models.SendSmsRequest(
        sign_name=settings.ALIYUN_SMS_SIGN_NAME,
        template_code=settings.ALIYUN_SMS_TEMPLATE_CODE,
        phone_numbers=phone,
        template_param=json.dumps({"code": str(code), "time": str(expire_minutes)}, ensure_ascii=False),
    )
    response = client.send_sms_with_options(request, util_models.RuntimeOptions())
    body = response.body
    if body and body.code != "OK":
        raise SmsGatewayError(
            body.message or "阿里云短信发送失败",
            code=body.code,
            request_id=body.request_id,
        )

    logger.info("Aliyun SMS sent: phone=%s request_id=%s", phone, getattr(body, "request_id", None))
    return {
        "provider": "aliyun",
        "requestId": getattr(body, "request_id", None),
        "bizId": getattr(body, "biz_id", None),
        "message": getattr(body, "message", None),
    }


def send_verification_sms(phone: str, code: str, expire_minutes: int) -> dict[str, Any]:
    provider = settings.SMS_PROVIDER.lower().strip()

    if provider == "mock":
        logger.info("[mock sms] phone=%s code=%s expire_minutes=%s", phone, code, expire_minutes)
        return {"provider": "mock"}

    if provider == "aliyun":
        return _send_with_aliyun(phone, code, expire_minutes)

    raise AppError(f"不支持的短信服务提供商: {settings.SMS_PROVIDER}", 500)
