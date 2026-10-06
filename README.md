# 网页实时翻译扩展

一个支持网页和漫画翻译的浏览器扩展，提供多种翻译模式和翻译引擎。

## 软件界面

### 网页翻译效果
![网页翻译效果](images/translator-forum.png)

## 功能特点

- **多种翻译模式**：
  - 轻量模式：仅翻译选定的文本内容
  - 完整模式：可翻译整个网页内容
  - 侧边栏全文翻译：一键翻译整个页面，自动处理滚动加载的内容

- **智能语言检测**：
  - 自动识别文本语言，只翻译非目标语言的内容
  - 避免对已经是目标语言(中文)的文本进行重复翻译
  - 智能分析文本中的语言占比，提高翻译精准度
  
- **多个翻译引擎**：
  - 本地大模型翻译（Ollama）
  - 百度翻译API
  - 阿里云翻译API
  - 自动切换功能：当一个翻译引擎失败时，自动切换到另一个

- **高效缓存**：
  - 内置翻译缓存机制，减少重复请求
  - 提高翻译速度，节省API调用次数

- **高级页面分析**：
  - 智能识别网页主要内容区域
  - 避免翻译导航、页脚等非关键区域
  - 针对不同网站类型（博客、论坛、代码仓库等）优化翻译体验

- **自动内容检测**：
  - 使用交叉观察器(Intersection Observer)监测元素可见性
  - 自动翻译滚动时新出现的内容
  - 监测DOM变化，确保动态加载的内容也能被翻译

- **错误恢复机制**：
  - 自动检测和恢复扩展连接中断
  - 翻译失败时自动重试
  - 友好的错误提示，指导用户解决问题

- **用户友好界面**：
  - 简洁的弹出设置菜单
  - 动画过渡效果
  - 清晰的状态反馈
  - 选中文本后在右下角显示小点，悬停或点击后请求翻译，离开选区和浮窗 500ms 后自动关闭

- **Firefox / Zen 支持**：
  - 根目录 `manifest.json` 是 Firefox/Zen 事件页版本，可直接临时加载
  - `manifest.chrome.json` 保留 Chrome Manifest V3 版本

- **漫画章节翻译**：
  - 在支持章节图片的漫画网页右下角直接点击“翻译本章”，无需先下载 HTML
  - `manga18.club/manhwa/.../chapter-N` 页面支持在当前页面后台翻译第 N+1 话；译图缓存后，可在之后打开该话时恢复
  - 从本地章节 HTML 提取普通图片、懒加载图片和 `slides_p_path` 图片数组
  - 逐张调用本地 `manga-translator-ui`，完成 OCR、原文擦除、翻译和排版
  - 翻译过程中支持暂停/继续，暂停会在当前图片处理完成后生效
  - 失败页面会单独标记，并可点击“重试失败页”只重新处理失败页面
  - 检测到不完整缓存时，可点击“继承缓存并继续”只完成尚未缓存的页面
  - 翻译结果生成后可用“显示原图 / 显示翻译图”按钮在当前页面切换预览
  - 支持预览进度，并下载内嵌翻译图片的中文 HTML 章节

## 系统架构

- **后台脚本** (`background.js`)：
  - 管理翻译API调用
  - 处理翻译缓存
  - 提供消息通信接口

- **内容脚本** (`content.js`, `content-simple.js`)：
  - 处理页面DOM元素识别
  - 管理翻译结果的显示
  - 处理用户交互

- **漫画网页入口** (`scripts/manga-page.js`)：
  - 从当前章节页面提取图片地址
  - 在当前网页提供逐张翻译、原图替换和暂停/继续控制

- **侧边栏翻译** (`sidebar-translator.js`)：
  - 提供页面全文翻译能力
  - 智能处理滚动加载内容
  - 使用观察器技术监控页面变化

- **弹出窗口** (`popup/popup.js`, `popup/popup.html`)：
  - 提供用户配置界面
  - 允许切换翻译模式和引擎

- **翻译核心** (`scripts/translator.js`)：
  - 包含翻译逻辑和处理函数
  - 提供API调用和错误处理

## 安装步骤

### Firefox / Zen

1. 克隆或下载此仓库
2. 在 Zen 地址栏打开 `about:debugging#/runtime/this-firefox`
3. 点击“此 Firefox” → “临时加载附加组件”
4. 选择仓库根目录中的 `manifest.json`

### Chrome / Chromium

1. 打开 `chrome://extensions/` 并开启“开发者模式”
2. 点击“加载已解压的扩展程序”
3. 将 `manifest.chrome.json` 复制到一个单独的 Chrome 构建目录并重命名为 `manifest.json`
4. 在“加载已解压的扩展程序”中选择这个构建目录（Firefox/Zen 仍直接加载根目录 `manifest.json`）

## 配置API凭据

使用此扩展需要配置翻译 API 凭据：

### 在线翻译API配置

在扩展弹窗的“翻译引擎”中选择“阿里云翻译”，填写 AccessKey ID 和 AccessKey Secret 后保存。凭据只保存到浏览器的 `storage.local`，不会写入源码、同步到浏览器账户，也不会发送到本项目服务器。

建议创建只允许机器翻译接口的 RAM 用户，不要把主账号 AccessKey 写入扩展。浏览器本地存储不是服务器端密钥保管系统；如果要多人使用或发布给其他用户，应增加本地或服务端代理，让 AccessKey Secret 不进入浏览器。

扩展调用阿里云机器翻译通用版 `TranslateGeneral`，单次请求最多 5000 字符。阿里云免费额度和超额计费以控制台当前规则为准。

### 本地大模型（Ollama）配置

如果您想使用本地大模型进行翻译，需要先安装和配置 Ollama：

1. **安装 Ollama**
   - 访问 [Ollama官网](https://ollama.ai/) 下载并安装 Ollama
   - 确保 Ollama 服务正在运行（默认端口为11434）

2. **下载语言模型**
   - 打开终端或命令提示符
   - 运行以下命令下载所需的模型（以 llama2 为例）：
     ```bash
     ollama pull llama2
     ```
   - 您也可以选择其他支持中英互译的模型

3. **在扩展中配置 Ollama**
   - 点击扩展图标打开设置面板
   - 在翻译引擎下拉菜单中选择"本地大模型(Ollama)"
   - 填写 Ollama API 地址（默认为 http://localhost:11434）
   - 填写模型名称（例如：llama2）
   - 点击"测试连接"确保配置正确
   - 点击"保存设置"完成配置

4. **使用注意事项**
   - 确保 Ollama 服务持续运行
   - 首次使用时翻译速度可能较慢，这是模型加载所需
   - 翻译质量取决于所选模型的性能
   - 建议使用支持中英互译的大模型以获得更好的翻译效果
   - 本地翻译不会产生API调用费用，但会占用本地计算资源

## 使用方法

### 基本使用

1. 安装扩展后，在浏览器右上角会出现扩展图标
2. 点击图标打开设置面板
3. 选择您偏好的翻译模式（轻量/完整）
4. 默认使用阿里云翻译，也可以切换到 Ollama 或百度翻译
5. 在网页上选中文本后，右下角会出现一个小点；悬停或点击小点后显示翻译结果，光标离开选区和浮窗 500ms 后自动关闭

### 侧边栏全文翻译功能

1. 在访问英文网页时，页面右侧会显示一个浮动的翻译按钮
2. 点击该按钮一次，将自动开始翻译页面中所有可见内容
3. 当滚动页面时，新出现的内容会自动被翻译
4. 再次点击按钮可以关闭翻译功能
5. 系统会智能识别内容语言，只翻译非中文的内容
6. 对于代码仓库页面（如GitHub或Gitee），系统会进行特殊优化以更好地展示README和代码注释

### 漫画章节翻译功能

1. 打开漫画章节网页；检测到章节图片后，右下角会出现“翻译本章”面板。点击后会在当前网页逐张读取、翻译并替换原图，不会把整章一次性导入插件页面。
2. Firefox/Zen 用户首次使用时，先运行 `native-host/install-macos.sh`；网页面板会按所选后端准备本机桥接和翻译服务。
3. 从扩展弹窗点击“漫画翻译配置”，或在漫画翻译页右上角打开配置页；可导入或导出 `manga-translator-ui` 完整配置，也可读取本机现有配置。首次读取本机配置后保存到扩展，即作为本地和 AIGate 共用配置。
4. 开始翻译前，扩展会把同一份配置应用到所选后端。本地模式会更新本机 `config/config.json`；AIGate 模式只在运行中的服务进程内应用，不会将这份配置写入云端共享磁盘。
5. 网页面板支持暂停/继续，暂停只会在当前图片处理完成后生效。
6. 如果网页没有显示入口，也可以从扩展弹窗点击“打开漫画章节翻译”，选择本地章节 HTML 作为备用方式；示例网站的 `slides_p_path` 图片地址会自动解析为章节图片列表。
7. 插件漫画翻译页仍可用于测试所选后端、查看图片列表和下载翻译版 HTML。

漫画翻译页的“翻译后端”可选择本地或 AIGate。使用 AIGate 时填写云扉 Bearer Token，刷新资源后选择区域、GPU 规格和个人镜像；也可以选择已有实例。创建实例会先显示规格和价格并要求确认，随后启动 AIGate 实例，通过 SSH 在 `/home/waas` 下定位 `manga-translator-ui` 项目与 Python 环境，启动 `shared` API（HTTP 6006）。原图逐张上传到云端，翻译结果逐张回传并保存到本机选择的目录及章节缓存清单。AIGate Token 保存在本机扩展存储中，不会写入项目源码。停止按钮会关闭所选实例。

漫画翻译使用 `manga-translator-ui` 的 App 核心 `shared` 模式，通过本机 `http://127.0.0.1:5003` 提供统一桥接服务。网页内嵌入口逐张使用 `/execute_image/translate`，插件章节页和 Qt 桌面端也共享同一个本机任务队列和翻译核心；批量桥接接口 `/execute_image/batch_translate` 保留给可持续持有流连接的客户端。网页入口不依赖长时间 `runtime.Port`，因此 Firefox/Zen 后台页重启不会中断整章任务。桥接进程由 Native Messaging 或 Qt 客户端按需启动，不启动 Web UI，也不要求 Web 登录。插件的配置页保存一份完整 JSON；本地翻译会将其写入桌面项目配置，AIGate 翻译会通过带 nonce 保护的 HTTPS 接口应用到云端进程内，并在任务开始前固定配置版本。配置内已有的第三方翻译密钥会随配置一并发送到所选云端服务。

“启动 App 核心桥接”通过 Firefox/Zen Native Messaging 调用本机启动器，启动命令固定为 `python -m manga_translator shared --host 127.0.0.1 --port 5003`，只监听本机回环地址，不会启动远程服务。Native Messaging 清单安装在 macOS 用户目录的 `~/Library/Application Support/Mozilla/NativeMessagingHosts/`。

### 智能语言检测

- 扩展会自动分析文本内容，检测是否为中文
- 如果文本已经是中文（超过40%的中文字符），则不会进行翻译
- 这避免了对已经是目标语言的内容进行不必要的翻译
- 系统会在复杂的混合语言内容中智能判断是否需要翻译

## 注意事项

- 翻译API可能有调用次数和频率限制
- 需要联网使用
- 百度翻译API和阿里云翻译API需要单独申请
- 侧边栏全文翻译功能在处理大型页面时可能需要一些时间

## 版权和许可

### 版权声明

Copyright © 2024 成都时光赛博科技有限公司。

本软件的原始知识产权归属于成都时光赛博科技有限公司。

### MIT 许可证

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

简体中文译文：

特此免费授予任何获得本软件及相关文档文件（"软件"）副本的人不受限制地处理本软件的权利，
包括但不限于使用、复制、修改、合并、发布、分发、再许可和/或出售该软件的副本，
以及允许获得该软件的人这样做，但须符合以下条件：

上述版权声明和本许可声明应包含在本软件的所有副本或重要部分中。

本软件按"原样"提供，不提供任何形式的明示或暗示的保证，包括但不限于对适销性、特定用途的
适用性和非侵权性的保证。在任何情况下，作者或版权持有人均不对任何索赔、损害或其他责任负责，
无论是在合同诉讼、侵权行为或其他方面，由软件或软件的使用或其他交易引起、产生或与之相关。

## 开发者信息

### 调试扩展

1. 在后台页面中打开开发者工具：
   - 在扩展管理页面点击"背景页"
   - 查看控制台输出的日志信息

2. 内容脚本调试：
   - 在任意网页上打开开发者工具
   - 查看控制台输出的`[Translator]`、`[Content]`和`[SidebarTranslator]`前缀的日志

### 项目结构

```
translator/
├── icons/                   # 扩展图标
├── popup/                   # 弹出窗口
│   ├── popup.html           # 弹出窗口HTML
│   └── popup.js             # 弹出窗口脚本
├── manga/                   # 漫画章节翻译页面
│   ├── manga.html           # HTML 章节选择与翻译进度页
│   ├── manga.js             # 图片提取、本地后端调用与结果下载
│   ├── manga.css            # 漫画翻译页面样式
│   ├── config.html          # manga-translator-ui 漫画配置页
│   ├── config.js            # 配置编辑、导入导出和本地/云端同步
│   └── config-schema.json   # 配置分组与字段清单
├── native-host/              # Firefox/Zen 本机后端启动器
│   ├── manga_backend_host.py # Native Messaging 主机逻辑
│   ├── manga_backend_host.c  # macOS/Zen 原生启动器源码
│   └── install-macos.sh      # 编译并安装本机启动器清单
├── scripts/                 # 主要脚本
│   ├── background.js        # 后台脚本
│   ├── selection-trigger.js  # Firefox/Zen 划词小点与结果卡片
│   ├── content.js           # 内容脚本
│   ├── content-simple.js    # 轻量模式内容脚本
│   ├── sidebar-translator.js # 侧边栏全文翻译功能
│   ├── translator.js        # 翻译核心逻辑
│   ├── translator-module.js # 翻译模块
│   ├── crypto.js            # 加密工具
│   ├── crypto-util.js       # 加密辅助函数
│   └── crypto-js.min.js     # 上游兼容资源（阿里云签名已使用浏览器原生 Web Crypto）
├── styles/                  # 样式文件
│   ├── content.css          # 内容样式
│   └── sidebar-button.css   # 侧边栏按钮样式
├── _locales/                # 本地化文件
├── manifest.json            # 扩展清单文件
└── README.md                # 项目说明文档
```

## 贡献与反馈

如果您发现任何问题或有改进建议，请提交PR。
