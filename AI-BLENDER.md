# AI-BLENDER.md — drive Blender with webai-claw

> Use this guide when the user wants to build, move, or render something in
> Blender. webai-claw must already be connected, and every `claw` block still
> needs `host` and exact `"v":3` as described in `AI-AGENT.md`.
>
> The user-facing installed copy is at `~/webai-claw-skills/AI-BLENDER.md`.
> Upload that file when the task needs Blender.

## 1. How the bridge works

The official Blender Lab MCP extension (`Extension id: mcp`) listens on a local
socket at `localhost:9876`. Messages are null-byte-delimited JSON:

```json
{"type":"execute","code":"<python code>","strict_json":true}
```

No MCP desktop app or extra server is needed. The installed client connects to
that socket directly.

## 2. Prerequisites

1. Install the official Blender Lab MCP extension (`mcp`) in Blender.
2. Enable **Allow Online Access** in Blender. Without it, the extension's
   startup timer does not register and nothing listens on port 9876.
3. Restart Blender after enabling it.
4. Verify that port 9876 is listening.

If port 9876 is not listening and the user has not installed the extension,
stop. Ask the user to install and restart Blender. Do not write a replacement
socket server or controller into Blender.

## 3. Sending Python to Blender

Write the Python code to a temporary file with an `exec` block, then run the
installed client with a second block:

```text
py -3 %USERPROFILE%\.webai-claw\skill\mcp_exec.py D:\tmp\do.py        (Windows)
python3 ~/.webai-claw/skill/mcp_exec.py /tmp/do.py                    (macOS)
```

Keep the two steps separate so failures are easy to locate.

Typical flow:

1. `exec`: write the Blender Python script to a local file.
2. `exec`: run `mcp_exec.py` against that file.
3. `attach`: upload a rendered image or exported file when the user wants it.

## 4. Verified capabilities

- Create, move, and scale primitives.
- Build a multi-part model with the bmesh data API, frame it with a camera
  using `TRACK_TO`, render with EEVEE, and return the image through `attach`.
- The full loop has been verified: chat command -> webai-claw exec -> Blender
  socket -> render -> attach -> image in chat.

## 5. Rendering an image

Prefer the data API (`bpy.data`, `bmesh`) over `bpy.ops`. The socket execution
context may not have a viewport, and `bpy.ops` can raise context errors.

A reliable test task:

1. clear the default scene;
2. add a cube, a camera, and a light;
3. set the camera with `TRACK_TO`;
4. render with EEVEE to a known absolute path such as
   `/tmp/webai-claw-blender-test.png`;
5. verify the file exists;
6. use an `attach` block to upload it.

## 6. Common pitfalls

- The default scene already contains a Cube. Delete or reuse it explicitly.
- `bpy.ops` may fail without viewport context; use data APIs.
- If port 9876 is not listening, **Allow Online Access** is usually off, or
  Blender was not restarted after enabling it.
- Framing can clip the top of a model. Pull the camera back and re-render.
- Large renders can take time; use a reasonable `timeout`.

## 7. Safety

Running Python through this bridge is equivalent to executing arbitrary code in
the user's Blender session.

- Inspect first: list objects and read properties before changing the scene.
- Before deleting objects, overwriting files, or making major scene changes,
  show the full code and wait for explicit user consent.
- Be especially careful with clearing the scene or overwriting `.blend` files.
