import json

import transcribe as t


class Seg:
    def __init__(self, text):
        self.text = text


class Info:
    language = "pt"


class FakeModel:
    def __init__(self):
        self.calls = []

    def transcribe(self, path, **kwargs):
        self.calls.append((path, kwargs))
        return iter([Seg(" oi "), Seg("mundo ")]), Info()


def test_transcribe_junta_segmentos_e_forca_o_idioma():
    model = FakeModel()
    result = t.transcribe("a.ogg", "small", "pt", model_factory=lambda name: model)
    assert result == {"text": "oi mundo", "language": "pt"}
    assert model.calls[0][1]["language"] == "pt"


def test_main_imprime_json_ascii(monkeypatch, capsys):
    monkeypatch.setattr(t, "transcribe", lambda *a, **k: {"text": "gastei R$ 50 no açaí", "language": "pt"})
    assert t.main(["a.ogg"]) == 0
    out = capsys.readouterr().out
    assert json.loads(out)["text"] == "gastei R$ 50 no açaí"
    assert out.isascii()


def test_main_reporta_erro_em_json_no_stderr(monkeypatch, capsys):
    def boom(*a, **k):
        raise RuntimeError("modelo indisponível")

    monkeypatch.setattr(t, "transcribe", boom)
    assert t.main(["a.ogg"]) == 1
    assert json.loads(capsys.readouterr().err)["error"] == "modelo indisponível"
