// ==UserScript==
// @name         NAIrecord(v2.46_E)
// @namespace    http://tampermonkey.net/
// @version      2.46
// @description  NovelAI 프롬프트 및 이미지 자동 전송 (Embed 방식, 긴 프롬프트 지원)
// @match        https://novelai.net/image*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
  'use strict';

  const WEBHOOK_KEY = 'NAI_DISCORD_WEBHOOK_URL_v2.46';

  function getWebhook(forcePrompt = false) {
    let url = localStorage.getItem(WEBHOOK_KEY);
    if (!url || forcePrompt) {
      url = prompt('📩 웹후크 주소를 입력하세요', '[https://discord.com/api/webhooks/](https://discord.com/api/webhooks/)...');
      if (url) localStorage.setItem(WEBHOOK_KEY, url.trim());
    }
    return url;
  }

  function showAlert(msg, duration = 1000) {
    const d = document.createElement('div');
    d.textContent = msg;
    Object.assign(d.style, {
      position: 'fixed', top: '20px', left: '50%',
      transform: 'translateX(-50%)',
      background: '#333', color: '#fff', padding: '8px 12px',
      borderRadius: '6px', zIndex: 9999, fontSize: '14px', opacity: '0.9'
    });
    document.body.appendChild(d);
    setTimeout(() => d.remove(), duration);
  }

  function getPrompt(idx) {
    return (document.querySelectorAll('.ProseMirror')[idx]?.innerText || '').trim();
  }

  function getSetting(labelText) {
    const label = Array.from(document.querySelectorAll('div, span, label'))
      .find(el => el.textContent.trim().startsWith(labelText));
    if (!label) return '';
    const container = label.closest('div');
    const num = container.querySelector('input[type="number"]');
    if (num) return num.value.trim();
    const single = container.querySelector(
      '.css-4t5j3y-singleValue, .css-1uccc91-singleValue, .css-4f02a0-singleValue'
    );
    return single ? single.textContent.trim() : '';
  }

  function getPromptGuidance(stepsVal) {
    const all = Array.from(document.querySelectorAll('input[type="number"], div'))
      .map(el => parseFloat(el.value || el.textContent))
      .filter(n => !isNaN(n));
    const idx = all.indexOf(stepsVal);
    if (idx >= 0 && idx + 1 < all.length) {
      const next = all[idx + 1];
      if (next >= 0 && next <= 10) return next.toFixed(1);
    }
    return '(Unknown)';
  }

  function getCharacterPrompts() {
    const items = [];
    for (let i = 1; i <= 5; i++) {
      const box = document.querySelector(`div.character-prompt-input.character-prompt-input-${i}`);
      if (!box) continue;
      const p = box.querySelector('div.ProseMirror > p');
      if (p && p.textContent.trim()) {
        items.push(`Character ${i}: ${p.textContent.trim()}`);
      }
    }
    return items.join('\n');
  }

  function getVibeTransfers() {
    const blocks = Array.from(document.querySelectorAll('.sc-bff03259-35'));
    if (blocks.length === 0) return '';
    const lines = [];
    blocks.forEach((block, idx) => {
      const nameInput = block.querySelector('input[type="text"]');
      const name = nameInput?.value?.trim() || `(No Name ${idx + 1})`;
      const numberInputs = block.querySelectorAll('input[type="number"]');
      const refStrength = numberInputs[0]?.value || '(Unknown)';
      const infoExtracted = numberInputs[1]?.value || '(Unknown)';
      lines.push(
        `Vibe Transfer ${idx + 1}: ${name}\n` +
        `Reference Strength: ${refStrength}\n` +
        `Information Extracted: ${infoExtracted}`
      );
    });
    return lines.join('\n\n');
  }

  function getImageSize() {
    const inputs = document.querySelectorAll('input[type="number"].sc-689ac2c0-43.hcJMLp');
    if (inputs.length >= 2) {
      const width = inputs[0].value.trim();
      const height = inputs[1].value.trim();
      if (width && height) {
        return `Size: ${width} × ${height}`;
      }
    }
    return '';
  }

  function splitText(name, text, maxLength = 1024) {
    if (!text || text.trim() === '') return [];

    // ★ 수정된 부분: 코드블록 기호(8자)를 뺀 실제 최대 길이를 계산
    const adjustedMaxLength = maxLength - 8;
    const chunks = [];

    for (let i = 0; i < text.length; i += adjustedMaxLength) {
      chunks.push(text.substring(i, i + adjustedMaxLength));
    }

    if (chunks.length === 1) {
      return [{ name, value: '```\n' + chunks[0] + '\n```', inline: false }];
    }
    return chunks.map((chunk, i) => ({
      name: `${name} (${i + 1}/${chunks.length})`,
      value: '```\n' + chunk + '\n```',
      inline: false,
    }));
  }

  async function runSend() {
    const WEBHOOK_URL = getWebhook();
    if (!WEBHOOK_URL) return showAlert('❌ 유효한 웹후크를 입력해주세요.', 1500);
    showAlert('✅ 저장·전송 중...', 800);

    const promptText = getPrompt(0);
    const negText = getPrompt(1);
    const charBlock = getCharacterPrompts();
    const vibeBlock = getVibeTransfers();
    const steps = getSetting('Steps');
    const sampler = getSetting('Sampler');
    const guidance = getPromptGuidance(parseFloat(steps));
    const sizeText = getImageSize();

    const charAndVibeText = ((charBlock ? charBlock + '\n\n' : '') + (vibeBlock || '')).trim();

    const settingsText = (
      (sizeText ? sizeText + '\n' : '') +
      `Steps: ${steps}\n` +
      `Sampler: ${sampler}\n` +
      `Prompt Guidance: ${guidance}`
    ).trim();

    const sendImage = document.getElementById('nai-image-toggle')?.checked;

    const fields = [
      ...splitText('Prompt', promptText),
      ...splitText('Negative Prompt', negText),
      ...splitText('Character Prompts', charAndVibeText),
      ...splitText('Settings', settingsText),
    ];

    const embed = {
      color: 5009087,
      fields: fields,
    };

    if (sendImage) {
      const imgEl = document.querySelector("img[src^='blob']");
      if (!imgEl) return showAlert('⚠️ 이미지 없음...', 1200);

      let imageBlob;
      try {
        imageBlob = await (await fetch(imgEl.src)).blob();
      } catch {
        return showAlert('⚠️ 이미지 로드 실패...', 1200);
      }

      embed.image = { url: 'attachment://image.png' };

      const formData = new FormData();
      formData.append('payload_json', JSON.stringify({ embeds: [embed] }));
      formData.append('file', imageBlob, 'image.png');

      fetch(WEBHOOK_URL, { method: 'POST', body: formData })
        .then(res => res.ok ? showAlert('✅ 전송 완료!', 1200) : showAlert(`❌ 전송 실패 (${res.status})`, 2000))
        .catch(() => showAlert('❌ 네트워크 오류...', 1200));

    } else {
      fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] })
      })
      .then(res => res.ok ? showAlert('✅ 텍스트 전송 완료!', 1200) : showAlert(`❌ 전송 실패 (${res.status})`, 2000))
      .catch(() => showAlert('❌ 네트워크 오류...', 1200));
    }
  }

  function createSendButton() {
    if (document.getElementById('nai-send-button')) return;

    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'fixed', bottom: '10px', right: '10px', zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: '6px'
    });
    const label = document.createElement('label');
    label.innerHTML = '🖼️';
    label.style.fontSize = '16px';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'nai-image-toggle';
    checkbox.checked = true;

    const btn = document.createElement('button');
    btn.id = 'nai-send-button';
    btn.textContent = '🚀 전송';
    Object.assign(btn.style, {
      padding: '6px 12px', background: '#4b6fff', color: '#fff',
      border: 'none', borderRadius: '8px', cursor: 'pointer',
      fontSize: '14px', boxShadow: '1px 1px 5px rgba(0,0,0,0.3)'
    });
    btn.addEventListener('click', runSend);

    label.appendChild(checkbox);
    container.appendChild(label);
    container.appendChild(btn);
    document.body.appendChild(container);
  }

  window.addEventListener('keydown', e => {
    if (!e.altKey) return;
    switch (e.code) {
      case 'KeyQ':
        e.preventDefault();
        runSend();
        break;
      case 'KeyW':
        e.preventDefault();
        getWebhook(true);
        break;
    }
  }, true);

  window.addEventListener('load', () => {
    if (!localStorage.getItem('NAI_FIRST_TIME_HELP_SHOWN')) {
      alert(
        '📢 처음 설치하셨다면 꼭 확인해 주세요!\n\n' +
        '📌 Tampermonkey에서 이 스크립트가 웹후크로 전송하려면 "Cross-origin 요청 허용" 권한이 필요합니다.\n\n' +
        '▶ 경고창이 뜨면 좌측 하단의 "도메인 항상 허용" 버튼을 눌러주세요!'
      );
      localStorage.setItem('NAI_FIRST_TIME_HELP_SHOWN', '1');
    }
    createSendButton();
  });

})();
