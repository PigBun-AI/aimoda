from backend.app.value_normalization import (
    normalize_quarter_list,
    normalize_quarter_value,
    normalize_string_list_value,
)


def test_normalize_quarter_value_maps_supported_aliases_to_canonical_values():
    assert normalize_quarter_value("q1") == "早春"
    assert normalize_quarter_value("resort") == "早春"
    assert normalize_quarter_value("SS") == "春夏"
    assert normalize_quarter_value("q3") == "早秋"
    assert normalize_quarter_value("pre-fall") == "早秋"
    assert normalize_quarter_value("AW") == "秋冬"
    assert normalize_quarter_value("fall/winter") == "秋冬"


def test_normalize_quarter_value_rejects_non_quarter_labels():
    assert normalize_quarter_value("高定") is None
    assert normalize_quarter_value("婚纱") is None
    assert normalize_quarter_value("Q5") is None


def test_normalize_quarter_list_deduplicates_and_filters_invalid_values():
    assert normalize_quarter_list(["resort", "Q1", "高定", "ss", "SS"]) == ["早春", "春夏"]


def test_normalize_string_list_value_accepts_json_array_strings():
    assert normalize_string_list_value('["jacket", "coat"]') == ["jacket", "coat"]
