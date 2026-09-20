// Исходящие команды CRM -> Облачная АТС (раздел 5 протокола).
// makeCall: АТС сначала звонит на телефон менеджера, потом соединяет с клиентом.
const PBX_ERROR_INVALID_PARAMS = { error: "Invalid parameters" } as const;

function pbxBaseUrl(): string {
  const url = process.env.PBX_API_URL;
  if (!url) throw new Error("PBX_API_URL is not set");
  return url.replace(/\/$/, "");
}

function pbxToken(): string {
  const token = process.env.PBX_API_TOKEN;
  if (!token) throw new Error("PBX_API_TOKEN is not set");
  return token;
}

// Звонок из карточки в один клик (раздел 5.3).
// userLogin — логин, внутренний или прямой номер сотрудника АТС (поле user).
// Возвращает CallID из тела ответа 200.
export async function makeCall(userLogin: string, phone: string): Promise<string> {
  if (!userLogin || !phone) throw new Error("Invalid parameters");
  const body = new URLSearchParams({
    cmd: "makeCall",
    user: userLogin,
    phone,
    token: pbxToken(),
  });
  const res = await fetch(pbxBaseUrl(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = (await res.text()).trim();
  if (res.status === 200) return text;
  if (res.status === 400) throw new Error(JSON.stringify(PBX_ERROR_INVALID_PARAMS));
  if (res.status === 401) throw new Error(JSON.stringify({ error: "Invalid token" }));
  throw new Error(`PBX makeCall failed: ${res.status} ${text}`);
}
