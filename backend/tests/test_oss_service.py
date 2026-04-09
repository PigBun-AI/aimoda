from app.services.oss_service import OSSService


class _FakeResult:
    status = 200


class _FakeBucket:
    def __init__(self) -> None:
        self.calls: list[tuple[str, bytes, dict[str, str]]] = []

    def put_object(self, key: str, data: bytes, headers: dict[str, str]):
        self.calls.append((key, data, headers))
        return _FakeResult()


def test_upload_file_normalizes_metadata_keys_for_oss_signature():
    service = OSSService(
        access_key_id="test-id",
        access_key_secret="test-secret",
        bucket_name="test-bucket",
        endpoint="oss-cn-shenzhen.aliyuncs.com",
    )
    fake_bucket = _FakeBucket()
    service._bucket = fake_bucket

    url = service.upload_file(
        "users/1/collections/demo/test.jpg",
        b"hello",
        content_type="image/jpeg",
        metadata={
            "collection_id": "abc-123",
            "Source": "favorite_upload",
            " weird key ": "value",
            "": "ignored",
            "nullish": None,
        },
    )

    assert url.endswith("/users/1/collections/demo/test.jpg")
    assert len(fake_bucket.calls) == 1
    _, payload, headers = fake_bucket.calls[0]
    assert payload == b"hello"
    assert headers["Content-Type"] == "image/jpeg"
    assert headers["x-oss-meta-collection-id"] == "abc-123"
    assert headers["x-oss-meta-source"] == "favorite_upload"
    assert headers["x-oss-meta-weird-key"] == "value"
    assert "x-oss-meta-collection_id" not in headers
    assert "x-oss-meta-" not in headers


def test_signed_urls_are_normalized_to_https():
    service = OSSService(
        access_key_id="test-id",
        access_key_secret="test-secret",
        bucket_name="aimoda",
        endpoint="oss-cn-shenzhen.aliyuncs.com",
    )

    normalized = service._normalize_signed_url(
        "http://aimoda.oss-cn-shenzhen.aliyuncs.com/users%2F1%2Fcollections%2Fdemo%2Ftest.jpg?Signature=demo"
    )

    assert normalized.startswith("https://aimoda.oss-cn-shenzhen.aliyuncs.com/")
