#!/Users/apple/Documents/github/manga-translator-ui/.venv/bin/python
"""Firefox/Zen Native Messaging host for the desktop-core translation bridge."""

from __future__ import annotations

import base64
import json
import filecmp
import os
import re
import secrets
import shlex
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit


PROJECT_ROOT = Path('/Users/apple/Documents/github/manga-translator-ui')
MANGA_CONFIG_PATH = PROJECT_ROOT / 'config' / 'config.json'
PYTHON_BIN = PROJECT_ROOT / '.venv' / 'bin' / 'python'
OPC_ROOT = Path('/Users/apple/Documents/github/OPC')
LOG_PATH = Path.home() / 'Library' / 'Logs' / 'ImmersiveTranslate' / 'manga-backend.log'
LEGACY_CACHE_ROOT = Path.home() / 'Library' / 'Application Support' / 'ImmersiveTranslate' / 'manga-cache'
PROCESS_DIR_NAME = '.immersive-translate'
TASK_ID_PATTERN = re.compile(r'^[A-Za-z0-9_-]{8,128}$')
STARTUP_TIMEOUT_SECONDS = 90
BRIDGE_ENDPOINT = 'http://127.0.0.1:5003'


def write_message(message: dict) -> None:
    payload = json.dumps(message, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def read_message() -> dict | None:
    header = sys.stdin.buffer.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise RuntimeError('Native Messaging 消息长度头不完整')
    size = struct.unpack('<I', header)[0]
    payload = sys.stdin.buffer.read(size)
    if len(payload) != size:
        raise RuntimeError('Native Messaging 消息内容不完整')
    value = json.loads(payload.decode('utf-8'))
    if not isinstance(value, dict):
        raise RuntimeError('Native Messaging 请求必须是 JSON 对象')
    return value


def backend_ready(endpoint: str) -> bool:
    request = Request(f'{endpoint}/backend_info', headers={'User-Agent': 'ImmersiveTranslate App Bridge'})
    try:
        with urlopen(request, timeout=2) as response:
            if not 200 <= response.status < 400:
                return False
            info = json.loads(response.read().decode('utf-8'))
            return (
                isinstance(info, dict)
                and info.get('service') == 'manga-translator-ui'
                and info.get('mode') == 'shared'
                and info.get('protocol') == 'manga-translator-ui-shared-v2'
                and info.get('projectRoot') == str(PROJECT_ROOT)
            )
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return False


def resolve_log_path(output_folder: str | None) -> Path:
    value = str(output_folder or '').strip()
    if not value:
        return LOG_PATH
    output_path = Path(value).expanduser()
    if not output_path.is_absolute():
        return LOG_PATH
    return output_path / PROCESS_DIR_NAME / 'logs' / 'manga-backend.log'


def _safe_work_name(value: object) -> str:
    """Keep one readable cache parent per work, independent of chapter."""
    raw = str(value or '').strip()
    if not raw:
        return 'unknown-work'
    try:
        parsed = urlsplit(raw)
        host = (parsed.hostname or parsed.netloc or '').lower()
        path_parts = [part for part in parsed.path.split('/') if part]
    except ValueError:
        host = ''
        path_parts = []
    work_parts = []
    for part in path_parts:
        if re.fullmatch(r'(?:chapter|ch)[-_]?\d+[a-z0-9-]*', part, re.IGNORECASE):
            break
        work_parts.append(part)
    components = [component for component in [host, *work_parts] if component]
    candidate = '__'.join(components) or raw
    candidate = re.sub(r'[^A-Za-z0-9._-]+', '-', candidate).strip('.-_')
    candidate = re.sub(r'-{2,}', '-', candidate)
    return candidate[:160] or 'unknown-work'


def has_manga_cache(
    output_folder: str | None,
    task_id: str | None,
    source_url: str | None = '',
) -> dict:
    """Probe a task manifest without starting the heavy translation backend."""
    value = str(output_folder or '').strip()
    safe_task_id = str(task_id or '').strip()
    if not value or not Path(value).expanduser().is_absolute() or not TASK_ID_PATTERN.fullmatch(safe_task_id):
        return {'success': True, 'found': False}
    tasks_root = Path(value).expanduser() / PROCESS_DIR_NAME / 'tasks'
    candidates = [
        tasks_root / _safe_work_name(source_url) / safe_task_id / 'manifest.json',
        tasks_root / safe_task_id / 'manifest.json',
    ]
    try:
        for manifest_file in candidates:
            if not manifest_file.is_file():
                continue
            manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
            pages = manifest.get('pages') if isinstance(manifest, dict) else None
            if isinstance(pages, dict) and pages:
                return {'success': True, 'found': True}
    except (OSError, ValueError, TypeError):
        pass
    return {'success': True, 'found': False}


def _merge_tree_and_remove(source: Path, target: Path) -> bool:
    """Copy a legacy artifact into its new home, then remove only verified sources."""
    try:
        if source.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            for child in source.iterdir():
                child_target = target / child.name
                if child.is_dir():
                    if not _merge_tree_and_remove(child, child_target):
                        return False
                elif not child_target.exists():
                    child_target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(child, child_target)
                    if child_target.stat().st_size != child.stat().st_size:
                        return False
                    child.unlink()
                else:
                    # Never overwrite a file already created in the selected
                    # output directory; retain the legacy copy if it differs.
                    if not filecmp.cmp(child, child_target, shallow=False):
                        return False
                    child.unlink()
            source.rmdir()
            return True

        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if not filecmp.cmp(source, target, shallow=False):
                return False
        else:
            shutil.copy2(source, target)
            if target.stat().st_size != source.stat().st_size:
                return False
        source.unlink()
        return True
    except (OSError, shutil.Error):
        return False


def _existing_formal_result(output_folder: Path, filename: str) -> Path | None:
    """Find an older formal result that matches a cached page's stem."""
    exact = output_folder / Path(filename).name
    if exact.is_file():
        return exact
    stem = Path(filename).stem
    candidates = sorted(
        candidate for candidate in output_folder.glob(f'{stem}.*')
        if candidate.is_file() and candidate.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.avif'}
    )
    return candidates[0] if candidates else None


def _promote_legacy_task(source_task: Path, output_folder: Path) -> Path | None:
    """Convert page PNG cache files into one canonical task manifest."""
    manifest_file = source_task / 'manifest.json'
    try:
        manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
        pages = manifest.get('pages') if isinstance(manifest, dict) else None
        if not isinstance(pages, dict) or not pages:
            return None
    except (OSError, ValueError, TypeError):
        return None

    task_id = source_task.name
    task_dir = (
        output_folder / PROCESS_DIR_NAME / 'tasks'
        / _safe_work_name(manifest.get('sourceUrl', ''))
        / task_id
    )
    translated_dir = task_dir / 'translated'
    translated_dir.mkdir(parents=True, exist_ok=True)
    promoted_pages = {}

    for key, page in pages.items():
        if not isinstance(page, dict):
            continue
        try:
            index = int(page.get('index', key))
        except (TypeError, ValueError):
            continue
        filename = Path(str(page.get('filename') or f'page-{index + 1}.png')).name
        source_file = source_task / Path(str(page.get('path') or f'page-{index:04d}.png')).name
        formal_result = _existing_formal_result(output_folder, filename)
        if formal_result is not None:
            canonical = translated_dir / formal_result.name
            if not canonical.exists():
                shutil.copy2(formal_result, canonical)
            if not filecmp.cmp(formal_result, canonical, shallow=False):
                return None
            if formal_result != canonical:
                formal_result.unlink()
        elif source_file.is_file():
            canonical = translated_dir / f'page-{index:04d}.png'
            if not canonical.exists():
                shutil.copy2(source_file, canonical)
            if not filecmp.cmp(source_file, canonical, shallow=False):
                return None
        else:
            continue

        try:
            relative_path = canonical.resolve().relative_to(output_folder.resolve())
        except (OSError, ValueError):
            return None
        promoted_pages[str(index)] = {
            'index': index,
            'filename': filename,
            'imageUrl': str(page.get('imageUrl') or '')[:4000],
            'path': str(relative_path),
            'updatedAt': int(page.get('updatedAt') or time.time()),
        }

    if not promoted_pages:
        return None

    task_manifest = {
        'taskId': task_id,
        'sourceUrl': str(manifest.get('sourceUrl') or '')[:4000],
        'updatedAt': int(manifest.get('updatedAt') or time.time()),
        'pages': promoted_pages,
    }
    target_manifest = task_dir / 'manifest.json'
    temp_manifest = target_manifest.with_suffix('.json.tmp')
    temp_manifest.write_text(json.dumps(task_manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    temp_manifest.replace(target_manifest)

    # Only remove the old PNG pages after the new manifest and canonical files
    # are in place. Keep any unexpected legacy files for manual inspection.
    for page in pages.values():
        if isinstance(page, dict):
            old_file = source_task / Path(str(page.get('path') or '')).name
            if old_file.is_file():
                old_file.unlink()
    try:
        manifest_file.unlink()
        source_task.rmdir()
    except OSError:
        pass
    return task_dir


def _canonicalize_existing_task_outputs(output_folder: Path) -> list[str]:
    """Move pre-dedup formal files into their task's translated directory."""
    tasks_root = output_folder / PROCESS_DIR_NAME / 'tasks'
    if not tasks_root.is_dir():
        return []
    moved: list[str] = []
    for task_dir in _iter_task_dirs(tasks_root):
        manifest_file = task_dir / 'manifest.json'
        if not task_dir.is_dir() or not manifest_file.is_file():
            continue
        try:
            manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
            pages = manifest.get('pages') if isinstance(manifest, dict) else None
            if not isinstance(pages, dict):
                continue
        except (OSError, ValueError, TypeError):
            continue

        translated_dir = task_dir / 'translated'
        translated_dir.mkdir(parents=True, exist_ok=True)
        changed = False
        old_to_new: dict[str, str] = {}
        for page in pages.values():
            if not isinstance(page, dict):
                continue
            relative_path = str(page.get('path') or '')
            source = (output_folder / relative_path).resolve()
            if not source.is_file() or source.parent != output_folder.resolve():
                continue
            target = translated_dir / source.name
            if not target.exists():
                shutil.copy2(source, target)
            if not filecmp.cmp(source, target, shallow=False):
                continue
            old_to_new[str(source)] = str(target.resolve())
            source.unlink()
            page['path'] = str(target.resolve().relative_to(output_folder.resolve()))
            changed = True

        if changed:
            temp_manifest = manifest_file.with_suffix('.json.tmp')
            temp_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
            temp_manifest.replace(manifest_file)
            moved.append(str(task_dir))

            old_map = output_folder / 'translation_map.json'
            if old_map.is_file() and old_to_new:
                try:
                    translation_map = json.loads(old_map.read_text(encoding='utf-8'))
                    if isinstance(translation_map, dict) and set(translation_map).issubset(old_to_new):
                        new_map = {old_to_new[key]: value for key, value in translation_map.items()}
                        target_map = translated_dir / 'translation_map.json'
                        target_map.write_text(json.dumps(new_map, ensure_ascii=False, indent=4), encoding='utf-8')
                        old_map.unlink()
                except (OSError, ValueError, TypeError):
                    pass
    return moved


def _iter_task_dirs(tasks_root: Path):
    if not tasks_root.is_dir():
        return
    for candidate in tasks_root.iterdir():
        if not candidate.is_dir() or candidate.name == '.DS_Store':
            continue
        if (candidate / 'manifest.json').is_file():
            yield candidate
            continue
        for task_dir in candidate.iterdir():
            if task_dir.is_dir() and (task_dir / 'manifest.json').is_file():
                yield task_dir


def _normalize_task_manifest_paths(task_dir: Path, output_folder: Path) -> bool:
    """Rewrite paths that still point at the pre-work-folder task layout."""
    manifest_file = task_dir / 'manifest.json'
    try:
        manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
    except (OSError, ValueError, TypeError):
        return False
    pages = manifest.get('pages') if isinstance(manifest, dict) else None
    if not isinstance(pages, dict):
        return False

    output_root = output_folder.resolve()
    old_prefix = f'{PROCESS_DIR_NAME}/tasks/{task_dir.name}/'
    changed = False
    for page in pages.values():
        if not isinstance(page, dict):
            continue
        raw_path = str(page.get('path') or '')
        if not raw_path:
            continue

        candidate = (output_folder / raw_path).resolve()
        if candidate.is_file():
            try:
                canonical = str(candidate.relative_to(output_root))
            except ValueError:
                continue
            if raw_path != canonical:
                page['path'] = canonical
                changed = True
            continue

        if not raw_path.startswith(old_prefix):
            continue
        relocated = (task_dir / raw_path[len(old_prefix):]).resolve()
        try:
            relocated.relative_to(task_dir.resolve())
            canonical = str(relocated.relative_to(output_root))
        except (OSError, ValueError):
            continue
        if relocated.is_file() and raw_path != canonical:
            page['path'] = canonical
            changed = True

    if not changed:
        return False
    temp_manifest = manifest_file.with_suffix('.json.tmp')
    try:
        temp_manifest.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding='utf-8',
        )
        temp_manifest.replace(manifest_file)
    except OSError:
        try:
            temp_manifest.unlink()
        except OSError:
            pass
        return False
    return True


def _migrate_task_layout(output_folder: Path) -> list[str]:
    """Move legacy tasks/<taskId> directories to tasks/<work>/<taskId>."""
    tasks_root = output_folder / PROCESS_DIR_NAME / 'tasks'
    if not tasks_root.is_dir():
        return []
    migrated: list[str] = []
    flat_tasks = [
        candidate for candidate in tasks_root.iterdir()
        if candidate.is_dir() and (candidate / 'manifest.json').is_file()
    ]
    for source_task in flat_tasks:
        try:
            manifest = json.loads((source_task / 'manifest.json').read_text(encoding='utf-8'))
            source_url = manifest.get('sourceUrl', '') if isinstance(manifest, dict) else ''
        except (OSError, ValueError, TypeError):
            continue
        target = tasks_root / _safe_work_name(source_url) / source_task.name
        if target == source_task:
            continue
        try:
            if target.exists():
                if _merge_tree_and_remove(source_task, target):
                    migrated.append(str(target))
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source_task), str(target))
            migrated.append(str(target))
        except (OSError, shutil.Error):
            continue

    for task_dir in _iter_task_dirs(tasks_root):
        if _normalize_task_manifest_paths(task_dir, output_folder):
            migrated.append(str(task_dir / 'manifest.json'))
    return migrated


def migrate_legacy_files(output_folder: str | None) -> list[str]:
    """Move known extension-owned cache/log files under the selected folder."""
    value = str(output_folder or '').strip()
    if not value:
        return []
    output_path = Path(value).expanduser()
    if not output_path.is_absolute():
        return []

    process_root = output_path / PROCESS_DIR_NAME
    migrated: list[str] = []

    cache_roots = [LEGACY_CACHE_ROOT, process_root / 'cache']
    for cache_root in cache_roots:
        if not cache_root.is_dir():
            continue
        for source_task in cache_root.iterdir():
            if source_task.name == '.DS_Store' or not source_task.is_dir():
                continue
            promoted = _promote_legacy_task(source_task, output_path)
            if promoted is not None:
                migrated.append(str(promoted))
        metadata_file = cache_root / '.DS_Store'
        if metadata_file.is_file():
            metadata_file.unlink()
        try:
            cache_root.rmdir()
        except OSError:
            pass

    migrated.extend(_canonicalize_existing_task_outputs(output_path))
    migrated.extend(_migrate_task_layout(output_path))

    legacy_log = LOG_PATH
    target_log = resolve_log_path(value)
    if legacy_log.is_file() and legacy_log != target_log and _merge_tree_and_remove(legacy_log, target_log):
        migrated.append(str(target_log))
    return migrated


def log_tail(log_path: Path) -> str:
    if not log_path.exists():
        return ''
    try:
        lines = log_path.read_text(encoding='utf-8', errors='replace').splitlines()
        return '\n'.join(lines[-8:])[-1600:]
    except OSError:
        return ''


def start_backend(output_folder: str | None = None) -> dict:
    if backend_ready(BRIDGE_ENDPOINT):
        return {'success': True, 'alreadyRunning': True, 'endpoint': BRIDGE_ENDPOINT, 'mode': 'app-core'}
    if not PROJECT_ROOT.is_dir():
        return {'success': False, 'error': f'项目目录不存在：{PROJECT_ROOT}'}
    if not PYTHON_BIN.is_file():
        return {'success': False, 'error': f'项目虚拟环境不存在：{PYTHON_BIN}'}

    migrated = migrate_legacy_files(output_folder)
    log_path = resolve_log_path(output_folder)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    project_path = str(PROJECT_ROOT)
    env['PYTHONPATH'] = project_path + os.pathsep + env.get('PYTHONPATH', '')
    env['PYTHONUNBUFFERED'] = '1'
    env['IMMERSIVE_TRANSLATE_LOG_PATH'] = str(log_path)
    command = [
        str(PYTHON_BIN), '-m', 'manga_translator', 'shared',
        '--host', '127.0.0.1', '--port', '5003',
    ]
    try:
        with log_path.open('a', encoding='utf-8') as log_file:
            process = subprocess.Popen(
                command,
                cwd=str(PROJECT_ROOT),
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                close_fds=True,
                start_new_session=True,
            )
    except OSError as error:
        return {'success': False, 'error': f'启动进程失败：{error}'}

    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            detail = log_tail(log_path)
            suffix = f'：{detail}' if detail else ''
            return {'success': False, 'error': f'统一后端进程启动失败{suffix}'}
        if backend_ready(BRIDGE_ENDPOINT):
            return {
                'success': True,
                'started': True,
                'endpoint': BRIDGE_ENDPOINT,
                'mode': 'app-core',
                'migrated': migrated,
            }
        time.sleep(1)
    detail = log_tail(log_path)
    suffix = f'\n最近日志：{detail}' if detail else ''
    return {'success': False, 'error': f'后端在 {STARTUP_TIMEOUT_SECONDS} 秒内未就绪。{suffix}'}


def pick_output_folder() -> dict:
    """Open a native macOS folder chooser for the extension settings page."""
    script = 'POSIX path of (choose folder with prompt "选择漫画翻译保存目录")'
    try:
        result = subprocess.run(
            ['/usr/bin/osascript', '-e', script],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'success': False, 'error': f'打开文件夹选择器失败：{error}'}
    if result.returncode != 0:
        return {'success': False, 'cancelled': True, 'error': '已取消选择保存目录'}
    output_folder = result.stdout.strip()
    if not output_folder:
        return {'success': False, 'cancelled': True, 'error': '未选择保存目录'}
    return {'success': True, 'outputFolder': output_folder}


def read_manga_config() -> dict:
    """Read the same config document used by the local shared translator."""
    try:
        config = json.loads(MANGA_CONFIG_PATH.read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        return {'success': False, 'error': f'读取 Manga Translator 配置失败：{error}'}
    if not isinstance(config, dict):
        return {'success': False, 'error': 'Manga Translator 配置文件顶层必须是 JSON 对象'}
    return {'success': True, 'config': config, 'path': str(MANGA_CONFIG_PATH)}


def _aigate_module():
    if not OPC_ROOT.is_dir():
        raise RuntimeError(f'OPC CLI 项目不存在：{OPC_ROOT}')
    if str(OPC_ROOT) not in sys.path:
        sys.path.insert(0, str(OPC_ROOT))
    from opc_cli import aigate
    return aigate


def _aigate_resources(request: dict) -> dict:
    token = str(request.get('token') or '').strip()
    area = str(request.get('area') or '华东一区').strip()
    if not token:
        return {'success': False, 'error': '请填写云扉 Bearer Token'}
    aigate = _aigate_module()
    try:
        skus = aigate.list_skus(token, area)
        images = aigate.list_personal_images(token)
        instances = aigate.list_instances(token)
        return {
            'success': True,
            'area': area,
            'skus': [
                {
                    'areaName': str(item.get('areaName') or area),
                    'skuName': str(item.get('skuName') or ''),
                    'price': item.get('price'),
                    'cpuCore': item.get('cpuCore'),
                    'memorySize': item.get('memorySize'),
                    'maxGpuCount': item.get('maxGpuCount'),
                }
                for item in skus
                if item.get('skuName')
            ],
            'images': [
                {
                    'worksId': str(item.get('worksId') or ''),
                    'name': str(item.get('name') or '未命名镜像'),
                    'areaName': str(item.get('areaName') or ''),
                    'status': str(item.get('status') or ''),
                    'imageVersion': str(item.get('imageVersion') or ''),
                }
                for item in images
                if item.get('worksId')
            ],
            'instances': [
                {
                    'instanceId': summary['instance_id'],
                    'instanceName': summary['instance_name'],
                    'operationStatus': summary['status'],
                    'statusLabel': summary['status_label'],
                    'areaName': str(item.get('areaName') or ''),
                }
                for item in instances
                for summary in [aigate.instance_summary(item)]
                if summary['instance_id']
            ],
        }
    except Exception as error:
        return {'success': False, 'error': f'读取云扉资源失败：{error}'}


def _aigate_create_instance(request: dict) -> dict:
    token = str(request.get('token') or '').strip()
    area = str(request.get('area') or '华东一区').strip()
    sku_name = str(request.get('skuName') or '').strip()
    image_id = str(request.get('imageId') or '').strip()
    image_type = str(request.get('imageType') or '3').strip()
    if not token or not sku_name or not image_id:
        return {'success': False, 'error': '请填写 Token、GPU 规格并选择可用镜像'}
    aigate = _aigate_module()
    try:
        images = aigate.list_personal_images(token)
        selected = next(
            (
                image for image in images
                if str(image.get('worksId') or '') == image_id
                and str(image.get('areaName') or area) == area
                and str(image.get('status') or '') == '1'
            ),
            None,
        )
        if selected is None or image_type != '3':
            return {'success': False, 'error': '所选个人镜像不可用，请刷新云扉资源后重试'}
        created = aigate.create_instance(token, sku_name, area, image_id, image_type)
        return {
            'success': True,
            'instanceId': str(created.get('instanceId') or ''),
            'instanceName': str(created.get('instanceName') or selected.get('name') or '云扉实例'),
            'skuName': sku_name,
            'areaName': area,
        }
    except Exception as error:
        return {'success': False, 'error': f'创建云扉实例失败：{error}'}


def _service_by_name(detail: dict, expected: str) -> dict | None:
    services = detail.get('instanceUtilList') if isinstance(detail, dict) else None
    if not isinstance(services, list):
        return None
    expected_name = re.sub(r'[^a-z0-9]', '', expected.lower())
    expected_port = 22 if expected_name == 'ssh' else 6006 if expected_name == 'http6006' else None
    for service in services:
        if not isinstance(service, dict):
            continue
        service_name = re.sub(r'[^a-z0-9]', '', str(service.get('name') or '').strip().lower())
        if service_name == expected_name:
            return service
        if expected_port is not None:
            mapped_ports = set()
            for key in ('instancePort', 'containerPort', 'port'):
                try:
                    port = int(service.get(key) or 0)
                except (TypeError, ValueError):
                    continue
                if 1 <= port <= 65535:
                    mapped_ports.add(port)
            if expected_port in mapped_ports:
                return service
    return None


def _service_mapping_error(detail: dict) -> str | None:
    missing = []
    if not _service_by_name(detail, 'ssh'):
        missing.append('SSH（容器端口 22）')
    if not _service_by_name(detail, 'HTTP 6006'):
        missing.append('HTTP 6006（容器端口 6006）')
    if not missing:
        return None

    services = detail.get('instanceUtilList') if isinstance(detail, dict) else None
    if not isinstance(services, list) or not services:
        returned = 'AIGate 未返回服务映射列表'
    else:
        descriptions = []
        for service in services:
            if not isinstance(service, dict):
                continue
            name = str(service.get('name') or '未命名服务').strip()
            ports = []
            for key in ('instancePort', 'containerPort', 'port'):
                value = str(service.get(key) or '').strip()
                if value and value not in ports:
                    ports.append(value)
            descriptions.append(f"{name}（端口 {', '.join(ports) if ports else '未知'}）")
        returned = '、'.join(descriptions) if descriptions else 'AIGate 返回了空服务项'
    missing_text = '、'.join(missing)
    return (
        f'当前 AIGate 实例缺少服务映射：{missing_text}。'
        f'镜像返回的映射：{returned}。'
        '请使用或创建同时映射 SSH 22 和 HTTP 6006 的镜像。'
    )


def _service_base_url(service: dict) -> str:
    raw = str(service.get('host') or '').strip().split('?', 1)[0].split('#', 1)[0].rstrip('/')
    if raw.startswith('https://'):
        authority = raw[8:]
    elif raw.startswith('http://'):
        authority = raw[7:]
    else:
        authority = raw
    if not authority or '/' in authority or any(character.isspace() for character in authority):
        raise RuntimeError('AIGate 未返回有效的 HTTP 6006 服务地址')
    hostname = authority.rsplit('@', 1)[-1].split(':', 1)[0].strip('[]').lower()
    if not hostname.endswith('.waas.aigate.cc'):
        raise RuntimeError('AIGate HTTP 6006 地址不属于 waas.aigate.cc')
    return 'https://' + authority


def _remote_start_script(nonce: str, probe_only: bool = False) -> str:
    nonce_base64 = base64.b64encode(nonce.encode('utf-8')).decode('ascii')
    probe_only_value = '1' if probe_only else '0'
    return f'''set -eu
NONCE="$(printf '%s' {shlex.quote(nonce_base64)} | base64 -d)"
PROBE_ONLY={probe_only_value}
STATE_DIR=/tmp/immersive-translate
PID_FILE="$STATE_DIR/shared-api.pid"
NONCE_FILE="$STATE_DIR/shared-api.nonce"
PROJECT_ROOT_FILE="$STATE_DIR/shared-api.project"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

SERVER_RUNNING=0
SERVER_PID=""
METADATA_MATCH=0
if [ -s "$PID_FILE" ]; then
  CANDIDATE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  CANDIDATE_COMMAND="$(ps -p "$CANDIDATE_PID" -o args= 2>/dev/null || true)"
  case "$CANDIDATE_COMMAND" in
    *'-m manga_translator shared'*)
      SERVER_PID="$CANDIDATE_PID"
      METADATA_MATCH=1
      ;;
  esac
fi

LISTENER_ENTRY=""
if command -v ss >/dev/null 2>&1; then
  LISTENER_ENTRY="$(ss -ltnp 2>/dev/null | awk '$4 ~ /:6006$/ {{print; exit}}' || true)"
fi
LISTENER_PID="$(printf '%s' "$LISTENER_ENTRY" | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1)"
if [ -z "$SERVER_PID" ] && [ -n "$LISTENER_PID" ]; then
  CANDIDATE_COMMAND="$(ps -p "$LISTENER_PID" -o args= 2>/dev/null || true)"
  case "$CANDIDATE_COMMAND" in
    *'-m manga_translator shared'*)
      SERVER_PID="$LISTENER_PID"
      ;;
  esac
fi

if [ -n "$SERVER_PID" ]; then
  PROBE_PYTHON="$(readlink -f "/proc/$SERVER_PID/exe" 2>/dev/null || true)"
  if [ ! -x "$PROBE_PYTHON" ]; then
    PROBE_PYTHON="$(command -v python3 || true)"
  fi
  COMMAND_NONCE=""
  if [ -n "$PROBE_PYTHON" ]; then
    COMMAND_NONCE="$("$PROBE_PYTHON" - "$SERVER_PID" 2>/dev/null <<'PY' || true
import sys
try:
    args = open('/proc/' + sys.argv[1] + '/cmdline', 'rb').read().split(b'\\0')
    for index, argument in enumerate(args[:-1]):
        if argument == b'--nonce':
            print(args[index + 1].decode('utf-8'))
            break
except Exception:
    pass
PY
)"
  fi
  RECOVERED_NONCE="$(cat "$NONCE_FILE" 2>/dev/null || true)"
  if [ -n "$COMMAND_NONCE" ] && [ "${{#COMMAND_NONCE}}" -ge 24 ]; then
    RECOVERED_NONCE="$COMMAND_NONCE"
  fi
  PROJECT_ROOT="$(readlink -f "/proc/$SERVER_PID/cwd" 2>/dev/null || true)"
  if [ -z "$PROJECT_ROOT" ]; then
    PROJECT_ROOT="$(cat "$PROJECT_ROOT_FILE" 2>/dev/null || true)"
  fi
  PROJECT_FILE="$PROJECT_ROOT/manga_translator/__main__.py"
  if [ -z "$PROBE_PYTHON" ] || [ -z "$RECOVERED_NONCE" ] || [ "${{#RECOVERED_NONCE}}" -lt 24 ] \
    || [ ! -f "$PROJECT_FILE" ]; then
    PROCESS_NAME="$(ps -p "$SERVER_PID" -o comm= 2>/dev/null || true)"
    echo "AIGATE_ERROR=existing port 6006 process could not be verified (PID $SERVER_PID, process ${{PROCESS_NAME:-unknown}})" >&2
    exit 21
  fi
  if [ "$METADATA_MATCH" != 1 ] || [ "$PROBE_ONLY" = 1 ]; then
    if "$PROBE_PYTHON" - "$RECOVERED_NONCE" <<'PY' >/dev/null 2>&1
import json
import sys
import time
import urllib.request
deadline = time.monotonic() + 20
while True:
    try:
        with urllib.request.urlopen('http://127.0.0.1:6006/backend_info', timeout=5) as response:
            info = json.loads(response.read().decode('utf-8'))
        if info.get('service') != 'manga-translator-ui' or info.get('mode') != 'shared':
            sys.exit(1)
        if info.get('protocol') != 'manga-translator-ui-shared-v2' or int(info.get('configApiVersion') or 0) < 1:
            sys.exit(1)
        request = urllib.request.Request('http://127.0.0.1:6006/config')
        request.add_header('X-Nonce', sys.argv[1])
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status != 200:
                sys.exit(1)
        break
    except Exception:
        if time.monotonic() >= deadline:
            sys.exit(1)
        time.sleep(2)
PY
    then
      :
    else
      PROCESS_NAME="$(ps -p "$SERVER_PID" -o comm= 2>/dev/null || true)"
      echo "AIGATE_ERROR=existing port 6006 process is not a verified shared translation service (PID $SERVER_PID, process ${{PROCESS_NAME:-unknown}})" >&2
      exit 21
    fi
  fi
  NONCE="$RECOVERED_NONCE"
  printf '%s' "$NONCE" > "$NONCE_FILE"
  chmod 600 "$NONCE_FILE"
  printf '%s' "$PROJECT_ROOT" > "$PROJECT_ROOT_FILE"
  chmod 600 "$PROJECT_ROOT_FILE"
  printf '%s' "$SERVER_PID" > "$PID_FILE"
  SERVER_RUNNING=1
else
  if [ -n "$LISTENER_ENTRY" ]; then
    if [ "$PROBE_ONLY" = 1 ]; then
      echo "AIGATE_ERROR=port 6006 is occupied by an unverified process (PID ${{LISTENER_PID:-unknown}})" >&2
    else
      echo "AIGATE_ERROR=port 6006 is already in use by another process (PID ${{LISTENER_PID:-unknown}})" >&2
    fi
    exit 24
  fi
  if [ "$PROBE_ONLY" = 1 ]; then
    echo 'AIGATE_ERROR=no running manga-translator shared service was found; start the service first' >&2
    exit 27
  fi
  rm -f "$PID_FILE" "$NONCE_FILE" "$PROJECT_ROOT_FILE"
  PROJECT_FILE="$(find /home/waas -maxdepth 6 -type f -path '*/manga-translator-ui/manga_translator/__main__.py' -print -quit 2>/dev/null || true)"
  if [ -z "$PROJECT_FILE" ]; then
    PROJECT_FILE="$(find /home/waas -maxdepth 6 -type f -path '*/manga_translator/__main__.py' ! -path '*/.venv/*' -print -quit 2>/dev/null || true)"
  fi
  if [ -z "$PROJECT_FILE" ]; then
    echo 'AIGATE_ERROR=manga-translator-ui source was not found under /home/waas' >&2
    exit 22
  fi
  PROJECT_ROOT="${{PROJECT_FILE%/manga_translator/__main__.py}}"
  PYTHON_BIN=""
  for CANDIDATE_PYTHON in \
    /opt/manga-translator-ui-venv/bin/python \
    "$PROJECT_ROOT/.venv/bin/python" \
    "$PROJECT_ROOT/venv/bin/python" \
    /home/waas/.venv/bin/python \
    /home/waas/venv/bin/python \
    "$(command -v python3 || true)"
  do
    if [ -x "$CANDIDATE_PYTHON" ] \
      && (cd "$PROJECT_ROOT" && PYTHONDONTWRITEBYTECODE=1 "$CANDIDATE_PYTHON" -c 'import manga_translator.mode.share' >/dev/null 2>&1); then
      PYTHON_BIN="$CANDIDATE_PYTHON"
      break
    fi
  done
  if [ -z "$PYTHON_BIN" ]; then
    echo 'AIGATE_ERROR=Python environment with manga-translator-ui dependencies was not found under /home/waas' >&2
    exit 23
  fi
  if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ':6006 '; then
    echo 'AIGATE_ERROR=port 6006 became occupied before the translation service could start' >&2
    exit 24
  fi
  if [ ! -d "$PROJECT_ROOT" ] || [ ! -f "$PROJECT_FILE" ]; then
    echo 'AIGATE_ERROR=selected manga-translator-ui project path is incomplete' >&2
    exit 25
  fi
  if [ ! -x "$PYTHON_BIN" ]; then
    echo 'AIGATE_ERROR=manga-translator-ui dependencies are not available in its Python environment' >&2
    exit 26
  fi
  cd "$PROJECT_ROOT"
  printf '%s' "$NONCE" > "$NONCE_FILE"
  chmod 600 "$NONCE_FILE"
  printf '%s' "$PROJECT_ROOT" > "$PROJECT_ROOT_FILE"
  chmod 600 "$PROJECT_ROOT_FILE"
  LOG_FILE="$STATE_DIR/shared-api.log"
  IMMERSIVE_TRANSLATE_LOG_PATH="$LOG_FILE" PYTHONDONTWRITEBYTECODE=1 \\
    nohup "$PYTHON_BIN" -m manga_translator shared --host 0.0.0.0 --port 6006 --nonce "$NONCE" \\
    > "$LOG_FILE" 2>&1 </dev/null &
  printf '%s' "$!" > "$PID_FILE"
fi

PROJECT_ROOT="${{PROJECT_FILE%/manga_translator/__main__.py}}"
printf 'IMT_PROJECT_B64=%s\\n' "$(printf '%s' "$PROJECT_ROOT" | base64 | tr -d '\\n')"
printf 'IMT_NONCE_B64=%s\\n' "$(printf '%s' "$NONCE" | base64 | tr -d '\\n')"
'''


def _start_remote_shared_server(request: dict, on_progress=None, probe_only: bool = False) -> dict:
    token = str(request.get('token') or '').strip()
    instance_id = str(request.get('instanceId') or '').strip()
    nonce = str(request.get('nonce') or secrets.token_urlsafe(32)).strip()
    if not token or not re.fullmatch(r'\d{6,32}', instance_id):
        return {'success': False, 'error': '请提供有效的云扉 Token 和实例 ID'}
    aigate = _aigate_module()
    try:
        detail = aigate.get_instance_detail(token, instance_id)
        # AIGate 通常会在实例启动前返回镜像端口映射；能检查时先检查，
        # 避免为缺少必需映射的镜像启动计费实例。
        services = detail.get('instanceUtilList') if isinstance(detail, dict) else None
        if isinstance(services, list) and services:
            mapping_error = _service_mapping_error(detail)
            if mapping_error:
                raise RuntimeError(mapping_error)
        status = aigate.instance_status(detail)
        if probe_only:
            if status != '2':
                raise RuntimeError(f'所选云扉实例当前未运行（状态 {status or "未知"}）；连通性检查不会启动实例')
        else:
            if status in {'3', '7', '22'}:
                if on_progress:
                    on_progress('正在启动云扉实例…')
                aigate.control_instance(token, instance_id, 'open')

            deadline = time.monotonic() + 300
            while time.monotonic() < deadline:
                detail = aigate.get_instance_detail(token, instance_id)
                status = aigate.instance_status(detail)
                if status == '2':
                    break
                if status == '4':
                    raise RuntimeError('所选云扉实例已释放')
                if on_progress:
                    on_progress(f'等待云扉实例启动（状态 {status or "未知"}）…')
                time.sleep(3)
            else:
                raise RuntimeError('等待云扉实例启动超时')

        mapping_error = _service_mapping_error(detail)
        if mapping_error:
            raise RuntimeError(mapping_error)
        ssh_service = _service_by_name(detail, 'ssh')
        http_service = _service_by_name(detail, 'HTTP 6006')
        ssh_host = str(ssh_service.get('host') or '').split('?', 1)[0].split('#', 1)[0].strip()
        ssh_port = int(ssh_service.get('instancePort') or ssh_service.get('port') or 0)
        if not ssh_host or '/' in ssh_host or any(character.isspace() for character in ssh_host):
            raise RuntimeError('AIGate 未返回有效的 SSH 地址')
        if ssh_port < 1 or ssh_port > 65535:
            raise RuntimeError('AIGate 未返回有效的 SSH 端口')
        base_url = _service_base_url(http_service)
        password = str(ssh_service.get('password') or '')
        ssh_command = shutil.which('ssh')
        if not ssh_command:
            raise RuntimeError('本机没有找到 ssh 命令')
        ssh_args = [
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'ConnectTimeout=20',
            '-o', 'BatchMode=yes',
            '-p', str(ssh_port),
            f'root@{ssh_host}',
            'bash -s',
        ]
        if on_progress:
            on_progress(
                '正在通过 SSH 检查所选实例上的翻译服务…'
                if probe_only else '正在通过 SSH 启动 /home/waas 中的 manga-translator-ui…'
            )
        env = os.environ.copy()
        remote = subprocess.run(
            [ssh_command, *ssh_args],
            input=_remote_start_script(nonce, probe_only=probe_only),
            capture_output=True,
            text=True,
            timeout=35,
            env=env,
            check=False,
        )
        ssh_error = (remote.stderr or '').lower()
        authentication_unavailable = any(
            marker in ssh_error
            for marker in ('permission denied', 'connection closed by')
        )
        if remote.returncode != 0 and password and authentication_unavailable:
            if on_progress:
                on_progress('云扉 SSH 公钥不可用，改用实例提供的密码认证…')
            sshpass = shutil.which('sshpass') or next(
                (
                    str(candidate)
                    for candidate in (
                        Path('/opt/homebrew/bin/sshpass'),
                        Path('/usr/local/bin/sshpass'),
                    )
                    if candidate.is_file() and os.access(candidate, os.X_OK)
                ),
                None,
            )
            if not sshpass:
                raise RuntimeError('AIGate SSH 公钥认证未成功；若要使用云扉密码认证，请先安装 sshpass')
            env['SSHPASS'] = password
            password_args = ssh_args.copy()
            password_args[password_args.index('BatchMode=yes')] = 'BatchMode=no'
            target_index = next(
                index for index, argument in enumerate(password_args)
                if argument.startswith('root@')
            )
            password_args[target_index:target_index] = [
                '-o', 'PreferredAuthentications=password',
                '-o', 'PubkeyAuthentication=no',
            ]
            remote = subprocess.run(
                [sshpass, '-e', ssh_command, *password_args],
                input=_remote_start_script(nonce, probe_only=probe_only),
                capture_output=True,
                text=True,
                timeout=90,
                env=env,
                check=False,
            )
        if remote.returncode != 0:
            detail_text = (remote.stderr or remote.stdout or '').strip().splitlines()
            safe_detail = detail_text[-1][:240] if detail_text else f'SSH 退出码 {remote.returncode}'
            prefix = '检查云端翻译服务失败' if probe_only else '启动云端翻译服务失败'
            raise RuntimeError(f'{prefix}：{safe_detail}')

        remote_values = {}
        for line in remote.stdout.splitlines():
            if line.startswith('IMT_PROJECT_B64='):
                remote_values['projectRoot'] = base64.b64decode(line.split('=', 1)[1]).decode('utf-8')
            elif line.startswith('IMT_NONCE_B64='):
                remote_values['nonce'] = base64.b64decode(line.split('=', 1)[1]).decode('utf-8')
        nonce = remote_values.get('nonce') or nonce
        if on_progress:
            on_progress('正在验证 AIGate HTTP 6006 服务和访问凭据…')

        deadline = time.monotonic() + 90
        info = None
        last_error = ''
        last_progress = time.monotonic()
        while time.monotonic() < deadline:
            try:
                with urlopen(Request(base_url + '/backend_info'), timeout=8) as response:
                    info = json.loads(response.read().decode('utf-8'))
                if (
                    isinstance(info, dict)
                    and info.get('service') == 'manga-translator-ui'
                    and info.get('mode') == 'shared'
                    and info.get('protocol') == 'manga-translator-ui-shared-v2'
                ):
                    try:
                        config_api_version = int(info.get('configApiVersion') or 0)
                    except (TypeError, ValueError):
                        config_api_version = 0
                    if config_api_version >= 1:
                        config_request = Request(base_url + '/config', headers={'X-Nonce': nonce})
                        with urlopen(config_request, timeout=8) as response:
                            if response.status != 200:
                                raise RuntimeError(f'配置 API 凭据验证失败：HTTP {response.status}')
                            response.read(1)
                        return {
                            'success': True,
                            'instanceId': instance_id,
                            'endpoint': base_url,
                            'nonce': nonce,
                            'projectRoot': remote_values.get('projectRoot') or info.get('projectRoot', ''),
                        }
                    raise RuntimeError('AIGate 服务已连通，但缺少统一配置 API v1；请更新项目并重启服务进程')
                else:
                    last_error = '服务协议不匹配'
            except HTTPError as error:
                last_error = f'HTTP {error.code}'
            except (URLError, TimeoutError, OSError, ValueError) as error:
                last_error = type(error).__name__
            if on_progress and time.monotonic() - last_progress >= 10:
                on_progress('AIGate 翻译服务仍在初始化，继续等待…')
                last_progress = time.monotonic()
            time.sleep(2)
        raise RuntimeError(f'AIGate 翻译服务未就绪：{last_error or "等待超时"}')
    except Exception as error:
        return {'success': False, 'error': str(error)}


def handle_request(request: dict, on_progress=None) -> dict:
    action = request.get('action')
    if action == 'hasMangaCache':
        return has_manga_cache(
            request.get('outputFolder'),
            request.get('taskId'),
            request.get('sourceUrl'),
        )
    if action == 'start':
        return start_backend(request.get('outputFolder'))
    if action == 'pickOutputFolder':
        return pick_output_folder()
    if action == 'readMangaConfig':
        return read_manga_config()
    if action == 'aigateResources':
        return _aigate_resources(request)
    if action == 'aigateCreateInstance':
        return _aigate_create_instance(request)
    if action == 'aigateStartTranslation':
        return _start_remote_shared_server(request, on_progress=on_progress)
    if action == 'aigateCheckTranslation':
        return _start_remote_shared_server(request, on_progress=on_progress, probe_only=True)
    if action == 'aigateStopInstance':
        token = str(request.get('token') or '').strip()
        instance_id = str(request.get('instanceId') or '').strip()
        if not token or not re.fullmatch(r'\d{6,32}', instance_id):
            return {'success': False, 'error': '请提供有效的云扉 Token 和实例 ID'}
        try:
            _aigate_module().control_instance(token, instance_id, 'close')
            return {'success': True, 'instanceId': instance_id}
        except Exception as error:
            return {'success': False, 'error': f'关闭云扉实例失败：{error}'}
    return {'success': False, 'error': '不支持的启动器操作'}


def main() -> None:
    while True:
        request = read_message()
        if request is None:
            return
        try:
            def report_progress(message: str) -> None:
                write_message({'progress': str(message)})

            result = handle_request(request, on_progress=report_progress)
            write_message({'done': True, **result})
        except Exception as error:  # Keep the host protocol alive for the next request.
            write_message({'done': True, 'success': False, 'error': str(error)})


if __name__ == '__main__':
    main()
