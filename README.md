# du-voice · 渡的声音

基于微软 Edge TTS 的免费语音合成 Worker，零成本部署在 Cloudflare Workers 上。

## 用法

- `POST /`  JSON: `{"input": "要合成的话", "voice": "zh-CN-YunyangNeural", "speed": 1.0, "pitch": "+0Hz"}` → 返回 `audio/mpeg`
- `GET /?input=你好&voice=zh-CN-YunyangNeural`  → 返回 `audio/mpeg`
- `GET /voices` → 可用音色列表

## 音色

- `zh-CN-XiaoxiaoNeural` 晓晓（女·温柔）
- `zh-CN-XiaoyiNeural` 晓伊（女·甜美）
- `zh-CN-YunxiNeural` 云希（男·年轻）
- `zh-CN-YunyangNeural` 云扬（男·沉稳，默认）
- `zh-CN-YunjianNeural` 云健（男·浑厚）

免费、无 key、无次数限制。
