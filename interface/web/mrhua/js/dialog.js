(function(){
        const overlay = document.getElementById('custom-modal-overlay');
        const msgEl = document.getElementById('custom-modal-msg');
        const btnsEl = document.getElementById('custom-modal-btns');

        function _showDialog(message, options) {
            return new Promise(resolve => {
                msgEl.textContent = message;
                btnsEl.innerHTML = '';
                if (options.showCancel) {
                    const cancelBtn = document.createElement('button');
                    cancelBtn.className = 'cm-btn cm-btn-cancel';
                    cancelBtn.textContent = options.cancelText || '取消';
                    cancelBtn.onclick = () => { overlay.classList.remove('cm-show'); resolve(false); };
                    btnsEl.appendChild(cancelBtn);
                }
                const okBtn = document.createElement('button');
                okBtn.className = 'cm-btn cm-btn-ok';
                okBtn.textContent = options.okText || '确定';
                okBtn.onclick = () => { overlay.classList.remove('cm-show'); resolve(true); };
                btnsEl.appendChild(okBtn);
                overlay.classList.add('cm-show');
                setTimeout(() => okBtn.focus(), 50);
            });
        }

        // 异步确认函数（推荐使用，避免原生 confirm 黑屏）
        window.confirmAsync = function(message, okText, cancelText) {
            return _showDialog(message, {showCancel: true, okText: okText || '确定', cancelText: cancelText || '取消'});
        };

        // 覆盖原生 alert（alert 无返回值，安全替换）
        const _nativeAlert = window.alert;
        window.alert = function(message) {
            try {
                _showDialog(String(message), {showCancel: false});
            } catch(e) {
                _nativeAlert.call(window, message);
            }
        };
    })();
