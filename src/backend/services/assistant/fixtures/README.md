These nonpersonal fixtures contain a 440 Hz synthetic tone lasting 0.2 seconds.
`audio.containers.test.ts` parses them with the installed `music-metadata` package;
transcription is mocked and makes no network request.

Generated with FFmpeg:

```sh
ffmpeg -f lavfi -i sine=frequency=440:duration=0.2 -c:a libopus tone.ogg
ffmpeg -f lavfi -i sine=frequency=440:duration=0.2 -c:a libopus tone.webm
ffmpeg -f lavfi -i sine=frequency=440:duration=0.2 -c:a aac -movflags +faststart tone.mp4
```

The MP4 uses AAC, matching the audio format commonly recorded by iOS. An actual
iOS recording and deployed Meta delivery remain release smoke checks.
