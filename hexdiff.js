/**
 * HexDump Diff - 高性能二进制数据对比工具
 * 支持手动输入十六进制数据
 * 使用虚拟滚动优化大数据性能
 */

class HexDiffViewer {
    constructor() {
        // 配置
        this.bytesPerRow = 16;
        this.rowHeight = 22;
        this.overscan = 10;
        
        // 数据
        this.dataA = null;
        this.dataB = null;
        this.diffMap = new Map();
        
        // 搜索
        this.searchMatches = [];
        this.currentMatchIndex = -1;
        
        // DOM 缓存
        this.elements = {};
        this.cacheElements();
        
        // 虚拟滚动状态
        this.scrollState = {
            A: { start: 0, end: 0 },
            B: { start: 0, end: 0 }
        };
        
        // RAF 节流
        this.pendingRender = { A: false, B: false };
        
        // 选择状态
        this.selection = {
            active: false,
            panel: null,
            start: -1,
            end: -1
        };
        
        // 初始化
        this.bindEvents();
        this.bindSelectionEvents();
        this.updateDiffGutter();
    }
    
    cacheElements() {
        const ids = [
            'inputA', 'inputB', 'byteCountA', 'byteCountB',
            'formatA', 'formatB', 'bytesPerRow', 'compareBtn', 'clearBtn', 'swapBtn',
            'contentA', 'contentB', 'viewportA', 'viewportB',
            'hexContainerA', 'hexContainerB', 'sizeA', 'sizeB',
            'searchInput', 'searchBtn', 'prevMatch', 'nextMatch', 'matchInfo',
            'jumpToOffset', 'exportDiff', 'jumpModal', 'jumpOffset',
            'jumpConfirm', 'jumpCancel', 'totalDiffs', 'currentOffset',
            'selectionInfo', 'diffCanvas', 'resultSection',
            'contextMenu', 'copyHex', 'copyHexNoSpace', 'copyAscii', 'copyCArray', 'selectAll'
        ];
        
        ids.forEach(id => {
            this.elements[id] = document.getElementById(id);
        });
    }
    
    bindEvents() {
        // 对比按钮（点击时显示错误）
        this.elements.compareBtn.addEventListener('click', () => this.compare(true));
        
        // 清空按钮
        this.elements.clearBtn.addEventListener('click', () => this.clear());
        
        // 交换按钮
        this.elements.swapBtn.addEventListener('click', () => this.swap());
        
        // 示例按钮
        document.querySelectorAll('.sample-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.loadSample(e.target.dataset.panel));
        });
        
        // 文件上传按钮
        this.bindFileUpload();
        
        // 拖拽文件
        this.bindDragDrop();
        
        // 输入实时解析并自动对比（防抖）
        this.debounceTimer = null;
        const autoCompare = () => {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => this.compare(), 150);
        };
        
        this.elements.inputA.addEventListener('input', () => {
            this.updateByteCount('A');
            autoCompare();
        });
        this.elements.inputB.addEventListener('input', () => {
            this.updateByteCount('B');
            autoCompare();
        });
        
        // 格式切换时自动重新对比
        this.elements.formatA.addEventListener('change', () => {
            this.updateByteCount('A');
            autoCompare();
        });
        this.elements.formatB.addEventListener('change', () => {
            this.updateByteCount('B');
            autoCompare();
        });
        
        // 折叠输入按钮
        const toggleInputBtn = document.getElementById('toggleInputBtn');
        const inputSection = document.querySelector('.input-section');
        toggleInputBtn.addEventListener('click', () => {
            inputSection.classList.toggle('collapsed');
            toggleInputBtn.textContent = inputSection.classList.contains('collapsed') ? '↕ 展开输入' : '↕ 折叠输入';
        });
        
        // 每行字节数
        this.elements.bytesPerRow.addEventListener('change', (e) => {
            this.bytesPerRow = parseInt(e.target.value);
            if (this.dataA || this.dataB) {
                this.resetScroll();
                this.render();
            }
        });
        
        // 滚动同步
        this.elements.viewportA.addEventListener('scroll', () => this.handleScroll('A'), { passive: true });
        this.elements.viewportB.addEventListener('scroll', () => this.handleScroll('B'), { passive: true });
        
        // 搜索
        this.elements.searchBtn.addEventListener('click', () => this.search());
        this.elements.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.search();
        });
        this.elements.prevMatch.addEventListener('click', () => this.navigateMatch(-1));
        this.elements.nextMatch.addEventListener('click', () => this.navigateMatch(1));
        
        // 跳转
        this.elements.jumpToOffset.addEventListener('click', () => this.showJumpModal());
        this.elements.jumpConfirm.addEventListener('click', () => this.jumpToOffset());
        this.elements.jumpCancel.addEventListener('click', () => this.hideJumpModal());
        this.elements.jumpOffset.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.jumpToOffset();
        });
        
        // 导出
        this.elements.exportDiff.addEventListener('click', () => this.exportDiff());
        
        // 窗口调整
        window.addEventListener('resize', () => {
            this.updateDiffGutter();
            if (this.dataA || this.dataB) this.render();
        });
        
        // 快捷键
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                this.compare(true);
            }
            if (e.ctrlKey && e.key === 'g') {
                e.preventDefault();
                this.showJumpModal();
            }
            if (e.ctrlKey && e.key === 'c' && this.selection.start >= 0) {
                e.preventDefault();
                this.copySelection('hex');
            }
        });
    }
    
    bindFileUpload() {
        ['A', 'B'].forEach(panel => {
            const uploadBtn = document.getElementById(`uploadBtn${panel}`);
            const fileInput = document.getElementById(`fileInput${panel}`);
            const closeBtn = document.querySelector(`.close-file-btn[data-panel="${panel}"]`);
            
            // 上传按钮点击
            uploadBtn.addEventListener('click', () => {
                fileInput.click();
            });
            
            // 文件选择
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.loadFile(file, panel);
                }
            });
            
            // 关闭文件显示
            closeBtn.addEventListener('click', () => {
                this.clearFileDisplay(panel);
            });
        });
    }
    
    bindDragDrop() {
        ['A', 'B'].forEach(panel => {
            const dropZone = document.getElementById(`dropZone${panel}`);
            
            // 阻止默认拖拽行为
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }, false);
            });
            
            // 拖入时高亮
            ['dragenter', 'dragover'].forEach(eventName => {
                dropZone.addEventListener(eventName, () => {
                    dropZone.classList.add('drag-over');
                }, false);
            });
            
            // 拖出时取消高亮
            ['dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, () => {
                    dropZone.classList.remove('drag-over');
                }, false);
            });
            
            // 处理文件放入
            dropZone.addEventListener('drop', (e) => {
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    this.loadFile(files[0], panel);
                }
            }, false);
        });
    }
    
    loadFile(file, panel) {
        const fileNameEl = document.getElementById(`fileName${panel}`);
        const fileOverlay = document.getElementById(`fileOverlay${panel}`);
        const inputEl = this.elements[`input${panel}`];
        
        // 显示文件名
        fileNameEl.textContent = file.name;
        fileOverlay.classList.add('active');
        
        // 读取文件
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const arrayBuffer = e.target.result;
            const uint8Array = new Uint8Array(arrayBuffer);
            
            // 转换为十六进制字符串
            const hexString = Array.from(uint8Array)
                .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
                .join(' ');
            
            // 设置输入内容
            inputEl.value = hexString;
            
            // 更新字节计数并触发对比
            this.updateByteCount(panel);
            this.compare();
        };
        
        reader.onerror = () => {
            alert(`读取文件失败: ${file.name}`);
            this.clearFileDisplay(panel);
        };
        
        // 读取为 ArrayBuffer
        reader.readAsArrayBuffer(file);
    }
    
    clearFileDisplay(panel) {
        const fileOverlay = document.getElementById(`fileOverlay${panel}`);
        const fileInput = document.getElementById(`fileInput${panel}`);
        const inputEl = this.elements[`input${panel}`];
        
        fileOverlay.classList.remove('active');
        fileInput.value = '';
        inputEl.value = '';
        
        this.updateByteCount(panel);
        this.compare();
    }
    
    bindSelectionEvents() {
        // 鼠标选择
        ['A', 'B'].forEach(panel => {
            const content = this.elements[`content${panel}`];
            
            content.addEventListener('mousedown', (e) => {
                // 只响应左键
                if (e.button !== 0) return;
                
                const byte = e.target.closest('.hex-byte[data-offset]');
                if (!byte) return;
                
                const offset = parseInt(byte.dataset.offset);
                this.selection = {
                    active: true,
                    panel: panel,
                    start: offset,
                    end: offset
                };
                this.updateSelectionDisplay();
            });
            
            content.addEventListener('mousemove', (e) => {
                if (!this.selection.active || this.selection.panel !== panel) return;
                
                const byte = e.target.closest('.hex-byte[data-offset]');
                if (!byte) return;
                
                const offset = parseInt(byte.dataset.offset);
                this.selection.end = offset;
                this.updateSelectionDisplay();
            });
            
            // 右键菜单
            content.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                
                const byte = e.target.closest('.hex-byte[data-offset]');
                
                // 调试日志
                console.log('右键点击 - 当前选择:', {
                    start: this.selection.start,
                    end: this.selection.end,
                    panel: this.selection.panel,
                    active: this.selection.active
                });
                
                if (byte) {
                    const offset = parseInt(byte.dataset.offset);
                    
                    // 只有在没有任何选择时，才选中右键点击的字节
                    if (this.selection.start < 0) {
                        this.selection = {
                            active: false,
                            panel: panel,
                            start: offset,
                            end: offset
                        };
                        this.updateSelectionDisplay();
                    }
                    // 如果已经有选择，保持不变，直接显示菜单
                }
                
                if (this.selection.start >= 0) {
                    this.showContextMenu(e.clientX, e.clientY);
                }
            });
        });
        
        // 鼠标释放结束选择
        document.addEventListener('mouseup', () => {
            if (this.selection.active) {
                this.selection.active = false;
            }
        });
        
        // 点击其他地方关闭菜单和清除选择
        document.addEventListener('mousedown', (e) => {
            // 只响应左键点击
            if (e.button !== 0) return;
            
            // 点击非hex区域清除选择
            if (!e.target.closest('.hex-byte') && !e.target.closest('.context-menu')) {
                this.clearSelection();
            }
        });
        
        // 点击其他地方关闭右键菜单
        document.addEventListener('click', (e) => {
            // 关闭右键菜单
            if (!e.target.closest('.context-menu')) {
                this.hideContextMenu();
            }
        });
        
        // 右键菜单项
        this.elements.copyHex.addEventListener('click', () => {
            this.copySelection('hex');
            this.hideContextMenu();
        });
        
        this.elements.copyHexNoSpace.addEventListener('click', () => {
            this.copySelection('hexNoSpace');
            this.hideContextMenu();
        });
        
        this.elements.copyAscii.addEventListener('click', () => {
            this.copySelection('ascii');
            this.hideContextMenu();
        });
        
        this.elements.copyCArray.addEventListener('click', () => {
            this.copySelection('carray');
            this.hideContextMenu();
        });
        
        this.elements.selectAll.addEventListener('click', () => {
            this.selectAllBytes();
            this.hideContextMenu();
        });
    }
    
    updateSelectionDisplay() {
        const start = Math.min(this.selection.start, this.selection.end);
        const end = Math.max(this.selection.start, this.selection.end);
        const count = end - start + 1;
        
        // 更新状态栏
        if (start >= 0) {
            this.elements.selectionInfo.textContent = `选中: ${count} 字节 (0x${start.toString(16).toUpperCase()}-0x${end.toString(16).toUpperCase()})`;
        } else {
            this.elements.selectionInfo.textContent = '';
        }
        
        // 更新视觉选择（通过重新渲染）
        this.render();
    }
    
    clearSelection() {
        this.selection = { active: false, panel: null, start: -1, end: -1 };
        this.elements.selectionInfo.textContent = '';
        this.render();
    }
    
    selectAllBytes() {
        const panel = this.selection.panel || 'A';
        const data = panel === 'A' ? this.dataA : this.dataB;
        if (!data || data.length === 0) return;
        
        this.selection = {
            active: false,
            panel: panel,
            start: 0,
            end: data.length - 1
        };
        this.updateSelectionDisplay();
    }
    
    showContextMenu(x, y) {
        const menu = this.elements.contextMenu;
        menu.classList.add('active');
        
        // 确保菜单不超出屏幕
        const rect = menu.getBoundingClientRect();
        const maxX = window.innerWidth - 170;
        const maxY = window.innerHeight - 200;
        
        menu.style.left = Math.min(x, maxX) + 'px';
        menu.style.top = Math.min(y, maxY) + 'px';
    }
    
    hideContextMenu() {
        this.elements.contextMenu.classList.remove('active');
    }
    
    copySelection(format) {
        if (this.selection.start < 0) return;
        
        const panel = this.selection.panel || 'A';
        const data = panel === 'A' ? this.dataA : this.dataB;
        if (!data) return;
        
        const start = Math.min(this.selection.start, this.selection.end);
        const end = Math.max(this.selection.start, this.selection.end);
        const bytes = data.slice(start, end + 1);
        
        let text = '';
        
        switch (format) {
            case 'hex':
                text = Array.from(bytes).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
                break;
            case 'hexNoSpace':
                text = Array.from(bytes).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
                break;
            case 'ascii':
                text = Array.from(bytes).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
                break;
            case 'carray':
                text = '{ ' + Array.from(bytes).map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(', ') + ' }';
                break;
        }
        
        navigator.clipboard.writeText(text).then(() => {
            // 可选：显示复制成功提示
        }).catch(err => {
            console.error('复制失败:', err);
        });
    }
    
    updateByteCount(panel) {
        const input = this.elements[`input${panel}`];
        const countEl = this.elements[`byteCount${panel}`];
        
        try {
            const bytes = this.parseInput(input.value, panel);
            countEl.textContent = `${bytes.length} 字节`;
            countEl.style.color = '';
        } catch (e) {
            countEl.textContent = '格式错误';
            countEl.style.color = 'var(--accent-red)';
        }
    }
    
    parseInput(text, panel) {
        if (!text.trim()) return new Uint8Array(0);
        
        const format = this.elements[`format${panel}`].value;
        
        switch (format) {
            case 'auto':
                return this.parseAuto(text);
            case 'hex':
                return this.parseHex(text);
            case 'hexdump':
                return this.parseHexdump(text);
            case 'c_array':
                return this.parseCArray(text);
            case 'base64':
                return this.parseBase64(text);
            default:
                return this.parseAuto(text);
        }
    }
    
    parseAuto(text) {
        const trimmed = text.trim();
        
        console.log('parseAuto - input (first 100 chars):', text.substring(0, 100));
        
        // 检测 Base64 (只包含 base64 字符且长度合适)
        // 排除纯十六进制的情况（只包含0-9a-fA-F和0x前缀）
        const cleanedForBase64Check = trimmed.replace(/\s/g, '');
        const isPureHex = /^(?:0x)?[0-9a-fA-F]+$/.test(cleanedForBase64Check.replace(/0x/gi, ''));
        const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(cleanedForBase64Check) && 
                         trimmed.length > 10 && 
                         !isPureHex;  // 排除纯十六进制
        console.log('parseAuto - isPureHex:', isPureHex);
        console.log('parseAuto - isBase64:', isBase64);
        if (isBase64) {
            try {
                console.log('parseAuto - trying Base64');
                return this.parseBase64(text);
            } catch (e) { 
                console.log('parseAuto - Base64 failed:', e);
            }
        }
        
        // 检测 hexdump 格式 (行首有地址)
        // 特征: 行首是长十六进制数(>=6位)，后面跟着冒号或多个空格，再跟着十六进制数据
        // 修复: 必须在地址后有实际的十六进制数据，避免误判纯地址列表
        const isHexdump = /^(?:0x)?[0-9a-fA-F]{6,}(?::|[ \t]{2,})[0-9a-fA-F]{2}/m.test(trimmed);
        console.log('parseAuto - isHexdump:', isHexdump);
        if (isHexdump) {
            console.log('parseAuto - using parseHexdump');
            return this.parseHexdump(text);
        }
        
        // 检测 C 数组格式
        const isCArray = /[{}\[\]]/.test(trimmed) || /0x[0-9a-fA-F]+\s*,/.test(trimmed);
        console.log('parseAuto - isCArray:', isCArray);
        if (isCArray) {
            console.log('parseAuto - using parseCArray');
            return this.parseCArray(text);
        }
        
        // 默认尝试纯十六进制
        console.log('parseAuto - using parseHex');
        return this.parseHex(text);
    }
    
    parseHex(text) {
        // 移除常见前缀和分隔符
        const cleaned = text
            .replace(/\\x/gi, '')
            .replace(/0x/gi, '')
            .replace(/[,\s\n\r\t;:\[\]{}()'"]+/g, '')
            .toUpperCase();
        
        console.log('parseHex - Original text:', text.substring(0, 100));
        console.log('parseHex - Cleaned:', cleaned.substring(0, 100));
        console.log('parseHex - Cleaned length:', cleaned.length);
        
        if (cleaned.length === 0) return new Uint8Array(0);
        if (cleaned.length % 2 !== 0) {
            throw new Error('十六进制字符数必须为偶数');
        }
        if (!/^[0-9A-F]+$/.test(cleaned)) {
            throw new Error('包含无效的十六进制字符');
        }
        
        const bytes = new Uint8Array(cleaned.length / 2);
        for (let i = 0; i < cleaned.length; i += 2) {
            bytes[i / 2] = parseInt(cleaned.substring(i, i + 2), 16);
        }
        
        console.log('parseHex - First 20 bytes:', Array.from(bytes.slice(0, 20)).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
        
        return bytes;
    }
    
    parseHexdump(text) {
        // 解析多种 hexdump 格式:
        // 1. xxd: 00000000: 4865 6c6c 6f20 576f 726c 6421 0a   Hello World!.
        // 2. WinDbg/调试器: 768fb64000  02 1f 3f 14 71 c6 18 40  ..?.q..@
        // 3. 简单格式: 00000000  48 65 6c 6c 6f
        console.log('parseHexdump - input (first 200 chars):', text.substring(0, 200));
        
        const lines = text.split('\n');
        const allBytes = [];
        
        for (const line of lines) {
            if (!line.trim()) continue;
            
            let hexPart = line;
            console.log('parseHexdump - processing line:', line);
            
            // 移除偏移地址 - 支持多种格式:
            // "00000000:" "768fb64000  " "0x00000000 "
            hexPart = hexPart.replace(/^(?:0x)?[0-9a-fA-F]+[:\s]+/, '');
            console.log('parseHexdump - after removing address:', hexPart);
            
            // 移除末尾的 ASCII 部分
            // ASCII 部分通常在两个或更多空格后，且包含可打印字符或点号
            // 匹配: "  ..?.q..@" 或 "  Hello World"
            hexPart = hexPart.replace(/\s{2,}[\x20-\x7E]+$/, '');
            console.log('parseHexdump - after removing ASCII:', hexPart);
            
            // 提取所有两位十六进制数 (支持空格分隔)
            const hexMatches = hexPart.match(/[0-9a-fA-F]{2}/g);
            console.log('parseHexdump - hex matches:', hexMatches);
            
            if (hexMatches) {
                for (const hex of hexMatches) {
                    allBytes.push(parseInt(hex, 16));
                }
            }
        }
        
        console.log('parseHexdump - total bytes:', allBytes.length);
        console.log('parseHexdump - first 20 bytes:', allBytes.slice(0, 20).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
        
        return new Uint8Array(allBytes);
    }
    
    parseCArray(text) {
        // 解析 C 数组格式: {0xFF, 0x00, ...} 或 unsigned char arr[] = {0xFF, ...};
        const matches = text.match(/(?:0x)?[0-9a-fA-F]{1,2}/g);
        if (!matches) return new Uint8Array(0);
        
        const bytes = matches.map(m => parseInt(m.replace(/^0x/i, ''), 16));
        return new Uint8Array(bytes);
    }
    
    parseBase64(text) {
        const cleaned = text.replace(/[\s\n\r]+/g, '');
        try {
            const binary = atob(cleaned);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        } catch (e) {
            throw new Error('无效的 Base64 数据');
        }
    }
    
    compare(showError = false) {
        try {
            this.dataA = this.parseInput(this.elements.inputA.value, 'A');
        } catch (e) {
            this.dataA = null;
            if (showError) alert('数据 A 解析错误: ' + e.message);
        }
        
        try {
            this.dataB = this.parseInput(this.elements.inputB.value, 'B');
        } catch (e) {
            this.dataB = null;
            if (showError) alert('数据 B 解析错误: ' + e.message);
        }
        
        this.elements.sizeA.textContent = this.dataA ? this.formatSize(this.dataA.length) : '';
        this.elements.sizeB.textContent = this.dataB ? this.formatSize(this.dataB.length) : '';
        
        this.computeDiff();
        // 强制清除渲染缓存，确保重新渲染
        this.scrollState = { A: { start: -1, end: -1 }, B: { start: -1, end: -1 } };
        this.render();
        this.updateDiffGutter();
    }
    
    computeDiff() {
        this.diffMap.clear();
        
        if (!this.dataA && !this.dataB) return;
        
        const lenA = this.dataA ? this.dataA.length : 0;
        const lenB = this.dataB ? this.dataB.length : 0;
        const maxLen = Math.max(lenA, lenB);
        
        let diffCount = 0;
        
        for (let i = 0; i < maxLen; i++) {
            const byteA = i < lenA ? this.dataA[i] : undefined;
            const byteB = i < lenB ? this.dataB[i] : undefined;
            
            if (byteA === undefined && byteB !== undefined) {
                this.diffMap.set(i, 'added');
                diffCount++;
            } else if (byteA !== undefined && byteB === undefined) {
                this.diffMap.set(i, 'removed');
                diffCount++;
            } else if (byteA !== byteB) {
                this.diffMap.set(i, 'modified');
                diffCount++;
            }
        }
        
        this.elements.totalDiffs.textContent = `差异: ${diffCount.toLocaleString()} 字节`;
    }
    
    clear() {
        this.elements.inputA.value = '';
        this.elements.inputB.value = '';
        this.dataA = null;
        this.dataB = null;
        this.diffMap.clear();
        this.searchMatches = [];
        this.currentMatchIndex = -1;
        
        this.elements.byteCountA.textContent = '0 字节';
        this.elements.byteCountB.textContent = '0 字节';
        this.elements.sizeA.textContent = '';
        this.elements.sizeB.textContent = '';
        this.elements.totalDiffs.textContent = '差异: 0 字节';
        this.elements.matchInfo.textContent = '';
        
        this.render();
        this.updateDiffGutter();
    }
    
    swap() {
        // 交换内容
        const tempA = this.elements.inputA.value;
        this.elements.inputA.value = this.elements.inputB.value;
        this.elements.inputB.value = tempA;
        
        // 交换格式
        const tempFormat = this.elements.formatA.value;
        this.elements.formatA.value = this.elements.formatB.value;
        this.elements.formatB.value = tempFormat;
        
        this.updateByteCount('A');
        this.updateByteCount('B');
        this.compare();
    }
    
    loadSample(panel) {
        const samples = {
            A: ' 48 65 6C 6C 6F 20 57 6F 72 6C 64 21 0A 54 68 69\n' +
               '73 20 69 73 20 61 20 74 65 73 74 20 66 69 6C 65\n' +
               '2E 0A 56 65 72 73 69 6F 6E 3A 20 31 2E 30 2E 30',
            B: '48 65 6C 6C 6F 20 57 6F 72 6C 64 21 0A 54 68 69\n' +
               '73 20 69 73 20 61 20 64 65 6D 6F 20 66 69 6C 65\n' +
               '2E 0A 56 65 72 73 69 6F 6E 3A 20 32 2E 30 2E 30'
        };
        
        this.elements[`input${panel}`].value = samples[panel];
        this.updateByteCount(panel);
    }
    
    handleScroll(panel) {
        const source = this.elements[`viewport${panel}`];
        const target = this.elements[`viewport${panel === 'A' ? 'B' : 'A'}`];
        
        if (Math.abs(source.scrollTop - target.scrollTop) > 1) {
            target.scrollTop = source.scrollTop;
        }
        
        const row = Math.floor(source.scrollTop / this.rowHeight);
        const offset = row * this.bytesPerRow;
        this.elements.currentOffset.textContent = `偏移: 0x${offset.toString(16).toUpperCase().padStart(8, '0')}`;
        
        if (!this.pendingRender[panel]) {
            this.pendingRender[panel] = true;
            requestAnimationFrame(() => {
                this.renderPanel(panel);
                this.pendingRender[panel] = false;
            });
        }
    }
    
    resetScroll() {
        this.scrollState = { A: { start: 0, end: 0 }, B: { start: 0, end: 0 } };
        this.elements.viewportA.scrollTop = 0;
        this.elements.viewportB.scrollTop = 0;
    }
    
    render() {
        this.renderPanel('A');
        this.renderPanel('B');
    }
    
    renderPanel(panel) {
        const data = panel === 'A' ? this.dataA : this.dataB;
        const content = this.elements[`content${panel}`];
        const viewport = this.elements[`viewport${panel}`];
        
        if (!data || data.length === 0) {
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📊</div>
                    <div>输入数据后点击对比</div>
                </div>
            `;
            return;
        }
        
        const totalRows = Math.ceil(data.length / this.bytesPerRow);
        const totalHeight = totalRows * this.rowHeight;
        
        const viewportHeight = viewport.clientHeight;
        const scrollTop = viewport.scrollTop;
        
        const startRow = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.overscan);
        const endRow = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / this.rowHeight) + this.overscan);
        
        if (this.scrollState[panel].start === startRow && 
            this.scrollState[panel].end === endRow) {
            return;
        }
        
        this.scrollState[panel] = { start: startRow, end: endRow };
        
        const rows = [];
        rows.push(`<div class="virtual-spacer-top" style="height:${startRow * this.rowHeight}px"></div>`);
        
        for (let row = startRow; row < endRow; row++) {
            const offset = row * this.bytesPerRow;
            const rowBytes = data.slice(offset, offset + this.bytesPerRow);
            rows.push(this.renderRow(offset, rowBytes, panel));
        }
        
        rows.push(`<div class="virtual-spacer-bottom" style="height:${(totalRows - endRow) * this.rowHeight}px"></div>`);
        
        content.innerHTML = rows.join('');
    }
    
    renderRow(offset, bytes, panel) {
        const offsetStr = offset.toString(16).toUpperCase().padStart(8, '0');
        
        let hexParts = [];
        let asciiParts = [];
        
        for (let i = 0; i < this.bytesPerRow; i++) {
            const byteOffset = offset + i;
            
            if (i > 0 && i % 8 === 0) {
                hexParts.push('<span class="byte-separator"></span>');
            }
            
            if (i < bytes.length) {
                const byte = bytes[i];
                const hexStr = byte.toString(16).toUpperCase().padStart(2, '0');
                
                let diffClass = '';
                const diff = this.diffMap.get(byteOffset);
                if (diff) diffClass = `diff-${diff}`;
                
                let matchClass = '';
                if (this.isSearchMatch(byteOffset)) matchClass = 'search-match';
                
                // 检查是否被选中
                let selectedClass = '';
                if (this.isSelected(byteOffset, panel)) selectedClass = 'selected';
                
                hexParts.push(`<span class="hex-byte ${diffClass} ${matchClass} ${selectedClass}" data-offset="${byteOffset}">${hexStr}</span>`);
                
                const char = byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.';
                const asciiClass = byte >= 32 && byte < 127 ? '' : 'non-printable';
                asciiParts.push(`<span class="ascii-char ${asciiClass} ${diffClass} ${selectedClass}">${this.escapeHtml(char)}</span>`);
            } else {
                hexParts.push('<span class="hex-byte">  </span>');
                asciiParts.push('<span class="ascii-char"> </span>');
            }
        }
        
        return `<div class="hex-row">
            <span class="offset">${offsetStr}</span>
            <span class="hex-bytes">${hexParts.join('')}</span>
            <span class="ascii-view">${asciiParts.join('')}</span>
        </div>`;
    }
    
    isSearchMatch(offset) {
        for (const match of this.searchMatches) {
            if (offset >= match.start && offset < match.end) return true;
        }
        return false;
    }
    
    isSelected(offset, panel) {
        if (this.selection.start < 0 || this.selection.panel !== panel) return false;
        const start = Math.min(this.selection.start, this.selection.end);
        const end = Math.max(this.selection.start, this.selection.end);
        return offset >= start && offset <= end;
    }
    
    search() {
        const input = this.elements.searchInput.value.trim();
        if (!input) return;
        
        let searchBytes;
        try {
            searchBytes = this.parseHex(input);
        } catch (e) {
            this.elements.matchInfo.textContent = '无效';
            return;
        }
        
        if (searchBytes.length === 0) return;
        
        this.searchMatches = [];
        this.currentMatchIndex = -1;
        
        const searchIn = (data) => {
            if (!data) return;
            for (let i = 0; i <= data.length - searchBytes.length; i++) {
                let match = true;
                for (let j = 0; j < searchBytes.length; j++) {
                    if (data[i + j] !== searchBytes[j]) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    this.searchMatches.push({ start: i, end: i + searchBytes.length });
                    i += searchBytes.length - 1;
                }
            }
        };
        
        searchIn(this.dataA);
        
        // 去重
        const unique = [];
        const seen = new Set();
        for (const m of this.searchMatches) {
            const key = `${m.start}-${m.end}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(m);
            }
        }
        this.searchMatches = unique;
        
        if (this.searchMatches.length > 0) {
            this.currentMatchIndex = 0;
            this.goToMatch(0);
        }
        
        this.updateMatchInfo();
        this.render();
    }
    
    navigateMatch(dir) {
        if (this.searchMatches.length === 0) return;
        
        this.currentMatchIndex += dir;
        if (this.currentMatchIndex < 0) this.currentMatchIndex = this.searchMatches.length - 1;
        if (this.currentMatchIndex >= this.searchMatches.length) this.currentMatchIndex = 0;
        
        this.goToMatch(this.currentMatchIndex);
        this.updateMatchInfo();
    }
    
    goToMatch(index) {
        const match = this.searchMatches[index];
        if (!match) return;
        
        const row = Math.floor(match.start / this.bytesPerRow);
        const scrollTop = row * this.rowHeight - 80;
        this.elements.viewportA.scrollTop = Math.max(0, scrollTop);
    }
    
    updateMatchInfo() {
        if (this.searchMatches.length === 0) {
            this.elements.matchInfo.textContent = '0';
        } else {
            this.elements.matchInfo.textContent = `${this.currentMatchIndex + 1}/${this.searchMatches.length}`;
        }
    }
    
    showJumpModal() {
        this.elements.jumpModal.classList.add('active');
        this.elements.jumpOffset.focus();
    }
    
    hideJumpModal() {
        this.elements.jumpModal.classList.remove('active');
        this.elements.jumpOffset.value = '';
    }
    
    jumpToOffset() {
        const input = this.elements.jumpOffset.value.trim();
        let offset = parseInt(input.replace(/^0x/i, ''), 16);
        
        if (isNaN(offset) || offset < 0) return;
        
        const maxLen = Math.max(
            this.dataA ? this.dataA.length : 0,
            this.dataB ? this.dataB.length : 0
        );
        
        offset = Math.min(offset, maxLen);
        
        const row = Math.floor(offset / this.bytesPerRow);
        this.elements.viewportA.scrollTop = row * this.rowHeight;
        this.hideJumpModal();
    }
    
    updateDiffGutter() {
        const canvas = this.elements.diffCanvas;
        const container = canvas.parentElement;
        
        canvas.width = container.clientWidth * window.devicePixelRatio;
        canvas.height = container.clientHeight * window.devicePixelRatio;
        canvas.style.width = container.clientWidth + 'px';
        canvas.style.height = container.clientHeight + 'px';
        
        const ctx = canvas.getContext('2d');
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, width, height);
        
        if (this.diffMap.size === 0) return;
        
        const maxLen = Math.max(
            this.dataA ? this.dataA.length : 0,
            this.dataB ? this.dataB.length : 0
        );
        
        if (maxLen === 0) return;
        
        const colors = {
            added: '#238636',
            removed: '#da3633',
            modified: '#d29922'
        };
        
        const blockSize = Math.max(1, Math.ceil(maxLen / height));
        const blocks = new Map();
        
        for (const [offset, type] of this.diffMap) {
            const blockIndex = Math.floor(offset / blockSize);
            if (!blocks.has(blockIndex)) blocks.set(blockIndex, new Set());
            blocks.get(blockIndex).add(type);
        }
        
        for (const [blockIndex, types] of blocks) {
            const y = (blockIndex / (maxLen / blockSize)) * height;
            let color = colors.added;
            if (types.has('modified')) color = colors.modified;
            else if (types.has('removed')) color = colors.removed;
            
            ctx.fillStyle = color;
            ctx.fillRect(width / 4, y, width / 2, Math.max(2, height / (maxLen / blockSize)));
        }
    }
    
    exportDiff() {
        if (this.diffMap.size === 0) {
            alert('没有差异可导出');
            return;
        }
        
        let output = 'HexDump Diff 报告\n';
        output += '='.repeat(60) + '\n\n';
        output += `数据 A: ${this.dataA ? this.dataA.length : 0} 字节\n`;
        output += `数据 B: ${this.dataB ? this.dataB.length : 0} 字节\n`;
        output += `总差异: ${this.diffMap.size} 字节\n\n`;
        output += '-'.repeat(60) + '\n\n';
        
        const sortedOffsets = [...this.diffMap.keys()].sort((a, b) => a - b);
        
        let regions = [];
        let currentRegion = null;
        
        for (const offset of sortedOffsets) {
            if (currentRegion === null || offset > currentRegion.end) {
                if (currentRegion) regions.push(currentRegion);
                currentRegion = { start: offset, end: offset + 1, type: this.diffMap.get(offset) };
            } else {
                currentRegion.end = offset + 1;
                if (currentRegion.type !== this.diffMap.get(offset)) currentRegion.type = 'mixed';
            }
        }
        if (currentRegion) regions.push(currentRegion);
        
        for (const region of regions) {
            const startHex = region.start.toString(16).toUpperCase().padStart(8, '0');
            const endHex = (region.end - 1).toString(16).toUpperCase().padStart(8, '0');
            const len = region.end - region.start;
            
            output += `偏移 0x${startHex} - 0x${endHex} (${len} 字节) [${region.type}]\n`;
            
            const showBytes = Math.min(16, len);
            for (let i = 0; i < showBytes; i++) {
                const off = region.start + i;
                const byteA = this.dataA && off < this.dataA.length ? this.dataA[off].toString(16).toUpperCase().padStart(2, '0') : '--';
                const byteB = this.dataB && off < this.dataB.length ? this.dataB[off].toString(16).toUpperCase().padStart(2, '0') : '--';
                output += `  0x${off.toString(16).toUpperCase().padStart(8, '0')}: A=${byteA} B=${byteB}\n`;
            }
            if (len > 16) output += `  ... 还有 ${len - 16} 字节\n`;
            output += '\n';
        }
        
        const blob = new Blob([output], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'hexdump-diff-report.txt';
        a.click();
        URL.revokeObjectURL(url);
    }
    
    formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(unitIndex > 0 ? 2 : 0)} ${units[unitIndex]}`;
    }
    
    escapeHtml(char) {
        const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return escapes[char] || char;
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    window.hexDiffViewer = new HexDiffViewer();
});
