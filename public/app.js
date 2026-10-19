function getKey() {
    return document.getElementById("adminKey").value.trim();
}

function showResult(html) {
    document.getElementById("result").innerHTML = html;
}

async function createUser() {
    const adminKey = getKey();
    const name = document.getElementById("userName").value.trim();
    const days = Number(document.getElementById("days").value);

    if (!adminKey) { showResult('<div class="error">Введите ADMIN_KEY</div>'); return; }
    if (!name) { showResult('<div class="error">Введите имя</div>'); return; }

    try {
        const response = await fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
            body: JSON.stringify({ name, days })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Ошибка");

        showResult(`
            <div class="success">
                <h3>Пользователь создан</h3>
                <p><b>Имя:</b> ${escapeHtml(data.user.name)}</p>
                <p><b>До:</b> ${escapeHtml(data.user.expires_at)}</p>
                <p><b>Subscription URL:</b></p>
                <textarea readonly>${escapeHtml(data.subscriptionUrl)}</textarea>
                <p><b>Happ:</b></p>
                <textarea readonly>${escapeHtml(data.happUrl)}</textarea>
            </div>
        `);
        loadUsers();
    } catch (error) {
        showResult(`<div class="error">${escapeHtml(error.message)}</div>`);
    }
}

async function loadUsers() {
    const adminKey = getKey();
    if (!adminKey) return;
    try {
        const response = await fetch("/api/users", { headers: { "x-admin-key": adminKey } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Ошибка");

        let html = "";
        for (const user of data.users) {
            html += `
                <div class="user">
                    <div><b>${escapeHtml(user.name)}</b></div>
                    <div class="small">ID: ${user.id}</div>
                    <div class="small">${user.active ? "ACTIVE" : "DISABLED"}</div>
                    <div class="small">До: ${escapeHtml(user.expires_at || "без срока")}</div>
                    <button onclick="toggleUser(${user.id}, ${user.active})">
                        ${user.active ? "Отключить" : "Включить"}
                    </button>
                </div>
            `;
        }
        document.getElementById("users").innerHTML =
            html || '<p class="muted">Пользователей нет</p>';
    } catch (error) {
        document.getElementById("users").innerHTML =
            `<div class="error">${escapeHtml(error.message)}</div>`;
    }
}

async function toggleUser(id, active) {
    const adminKey = getKey();
    const action = active ? "disable" : "enable";
    try {
        const response = await fetch(`/api/users/${id}/${action}`, {
            method: "POST",
            headers: { "x-admin-key": adminKey }
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Ошибка");
        loadUsers();
    } catch (error) {
        alert(error.message);
    }
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
