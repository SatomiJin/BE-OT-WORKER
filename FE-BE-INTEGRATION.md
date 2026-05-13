# OTWORKER FE-BE API Integration Guide

Tai lieu nay de gui cho FE team de tich hop voi backend OTWORKER hien tai.

## 1. Tong quan

- Backend stack: Node.js + Supabase
- Base URL local mac dinh: `http://localhost:3000`
- Health check public: `GET /health`
- Tat ca response tra ve dang JSON, tru route `204 No Content`
- Du lieu duoc luu trong Supabase table `public.otworker_profiles`
- Luong moi uu tien dung route `/api/profiles/me*` de thao tac theo account dang dang nhap
- Cac route `/api/profiles/:username*` van duoc giu de tuong thich nguoc

## 2. Cach FE nen tich hop

- FE login bang Supabase Auth
- FE lay `access_token` tu session hien tai
- FE gui token vao header `Authorization: Bearer <access_token>` cho moi request `/api/*`
- FE nen dung route `/api/profiles/me*` thay vi phu thuoc `username` trong URL
- Neu user chua co profile, FE goi `POST /api/profiles/me/init` mot lan dau

## 3. Authentication

Tat ca route duoi `/api/*` deu can:

```http
Authorization: Bearer <Supabase access_token>
Content-Type: application/json
```

Backend verify Supabase JWT local bang JWKS, khong goi `supabase.auth.getUser()` tren moi request.

### Route can auth

- `GET /api/me`
- `GET /api/profiles/me`
- `POST /api/profiles/me/init`
- `PUT /api/profiles/me`
- `GET /api/profiles/me/entries`
- `POST /api/profiles/me/entries`
- `PUT /api/profiles/me/entries/:entryId`
- `DELETE /api/profiles/me/entries/:entryId`
- `GET /api/profiles/me/timer`
- `PUT /api/profiles/me/timer`
- `POST /api/profiles/me/timer/start`
- `POST /api/profiles/me/timer/stop`
- `POST /api/profiles`
- `GET /api/profiles/:username`
- `PUT /api/profiles/:username`
- `DELETE /api/profiles/:username`
- `GET /api/profiles/:username/entries`
- `POST /api/profiles/:username/entries`
- `PUT /api/profiles/:username/entries/:entryId`
- `DELETE /api/profiles/:username/entries/:entryId`
- `GET /api/profiles/:username/timer`
- `PUT /api/profiles/:username/timer`
- `POST /api/profiles/:username/timer/start`
- `POST /api/profiles/:username/timer/stop`

### Route khong can auth

- `GET /health`

## 4. Rule nghiep vu va format du lieu

- Moi account chi co 1 profile
- `profile` duoc gan voi account qua `authUserId = request.auth.sub`
- Route `/api/profiles/me*` doc va ghi theo account dang login
- `username` bat buoc lowercase, slug-style
- `selectedMonth` format: `YYYY-MM`
- `date` format: `YYYY-MM-DD`
- `startTime` format: `HH:MM`
- `endTime` format: `HH:MM`, co cho phep `24:00`
- Ho tro OT qua ngay, vi du `22:00 -> 01:00`
- Moi profile chi co toi da 1 `activeTimer`
- Khi start/stop timer, backend dung server time
- `activeTimer.startedAt` luu dang UTC ISO string

## 5. Cau truc du lieu

### Profile

```json
{
  "username": "dong-huu-trong",
  "selectedMonth": "2026-05",
  "employee": {
    "label": "DONG",
    "employeeCode": "EMP001",
    "fullName": "Dong Huu Trong",
    "sheetName": "Trang tinh1"
  },
  "activeTimer": {
    "startedAt": "2026-05-13T12:00:00.000Z",
    "note": "retest task OMS-4026"
  },
  "entries": [
    {
      "id": "ot-001",
      "date": "2026-05-13",
      "startTime": "19:00",
      "endTime": "21:00",
      "note": "manual supabase check"
    }
  ]
}
```

### Entry

```json
{
  "id": "ot-001",
  "date": "2026-05-13",
  "startTime": "19:00",
  "endTime": "21:00",
  "note": "manual supabase check"
}
```

### Active Timer

```json
{
  "startedAt": "2026-05-13T12:00:00.000Z",
  "note": "manual supabase check"
}
```

## 6. Endpoint chi tiet

### 6.1. Health Check

`GET /health`

Response `200`:

```json
{
  "status": "ok"
}
```

### 6.2. Lay context user dang login

`GET /api/me`

Response `200`:

```json
{
  "sub": "supabase-user-id",
  "email": "user@company.com",
  "role": "authenticated",
  "profile": {
    "username": "dong-huu-trong"
  }
}
```

Neu user chua co profile thi:

```json
{
  "sub": "supabase-user-id",
  "email": "user@company.com",
  "role": "authenticated",
  "profile": null
}
```

## 7. Profile API

### 7.1. Tao profile cho account hien tai

`POST /api/profiles/me/init`

Request:

```json
{
  "username": "dong-huu-trong"
}
```

Response `201`:

```json
{
  "username": "dong-huu-trong",
  "selectedMonth": "2026-05",
  "employee": {
    "label": "DONG",
    "employeeCode": "",
    "fullName": "",
    "sheetName": "Trang tinh1"
  },
  "activeTimer": null,
  "entries": []
}
```

Response `409`:

```json
{
  "message": "Profile already exists for the current user."
}
```

### 7.2. Lay profile cua account hien tai

`GET /api/profiles/me`

Response `200`: tra ve `Profile`

Response `404`:

```json
{
  "message": "Profile for the current user was not found."
}
```

### 7.3. Cap nhat profile cua account hien tai

`PUT /api/profiles/me`

Request:

```json
{
  "selectedMonth": "2026-05",
  "employee": {
    "label": "DONG",
    "employeeCode": "EMP001",
    "fullName": "Dong Huu Trong",
    "sheetName": "Trang tinh1"
  }
}
```

Co the gui:

- chi `selectedMonth`
- chi `employee`
- hoac gui ca hai

Response `200`: tra ve `Profile` moi nhat

### 7.4. Route cu de tao profile bang username

`POST /api/profiles`

Request:

```json
{
  "username": "dong-huu-trong"
}
```

Response `201`: tra ve `Profile`

### 7.5. Route cu de lay profile theo username

`GET /api/profiles/:username`

Response `200`: tra ve `Profile`

### 7.6. Route cu de cap nhat profile theo username

`PUT /api/profiles/:username`

Request giong `PUT /api/profiles/me`

Response `200`: tra ve `Profile`

### 7.7. Route cu de xoa profile theo username

`DELETE /api/profiles/:username`

Response `204`

## 8. Entry API

### 8.1. Lay danh sach OT cua account hien tai

`GET /api/profiles/me/entries`

Ho tro query thang:

`GET /api/profiles/me/entries?month=2026-05`

Response `200`:

```json
[
  {
    "id": "ot-001",
    "date": "2026-05-13",
    "startTime": "19:00",
    "endTime": "21:00",
    "note": "manual supabase check"
  }
]
```

### 8.2. Tao OT entry cho account hien tai

`POST /api/profiles/me/entries`

Request:

```json
{
  "date": "2026-05-13",
  "startTime": "19:00",
  "endTime": "21:00",
  "note": "manual supabase check"
}
```

Response `201`:

```json
{
  "id": "ot-001",
  "date": "2026-05-13",
  "startTime": "19:00",
  "endTime": "21:00",
  "note": "manual supabase check"
}
```

### 8.3. Sua OT entry cua account hien tai

`PUT /api/profiles/me/entries/:entryId`

Request:

```json
{
  "date": "2026-05-13",
  "startTime": "20:00",
  "endTime": "22:00",
  "note": "updated note"
}
```

Response `200`: tra ve `Entry` moi nhat

### 8.4. Xoa OT entry cua account hien tai

`DELETE /api/profiles/me/entries/:entryId`

Response `204`

### 8.5. Route cu theo username

- `GET /api/profiles/:username/entries`
- `GET /api/profiles/:username/entries?month=2026-05`
- `POST /api/profiles/:username/entries`
- `PUT /api/profiles/:username/entries/:entryId`
- `DELETE /api/profiles/:username/entries/:entryId`

Request/response giong het route `/me`

## 9. Timer API

### 9.1. Lay active timer cua account hien tai

`GET /api/profiles/me/timer`

Response `200`:

```json
{
  "startedAt": "2026-05-13T12:00:00.000Z",
  "note": "manual supabase check"
}
```

Neu chua co timer:

```json
null
```

### 9.2. Start timer cho account hien tai

`POST /api/profiles/me/timer/start`

Request:

```json
{
  "note": "manual supabase check"
}
```

Response `200`:

```json
{
  "startedAt": "2026-05-13T12:00:00.000Z",
  "note": "manual supabase check"
}
```

Neu da co timer dang chay:

```json
{
  "message": "An active timer already exists for this profile."
}
```

### 9.3. Cap nhat note cua active timer

`PUT /api/profiles/me/timer`

Request:

```json
{
  "note": "updated timer note"
}
```

Response `200`: tra ve `Active Timer`

### 9.4. Stop timer va tu dong tao OT entry

`POST /api/profiles/me/timer/stop`

Request:

```json
{
  "note": "final timer note"
}
```

Rule:

- Neu `note` la chuoi rong `""` thi backend giu lai note cu cua timer
- Khi stop, backend tao 1 `entry` moi dua tren `startedAt` va thoi diem stop

Response `200`:

```json
{
  "id": "ot-001",
  "date": "2026-05-13",
  "startTime": "19:00",
  "endTime": "21:00",
  "note": "final timer note"
}
```

### 9.5. Route cu theo username

- `GET /api/profiles/:username/timer`
- `PUT /api/profiles/:username/timer`
- `POST /api/profiles/:username/timer/start`
- `POST /api/profiles/:username/timer/stop`

Request/response giong het route `/me`

## 10. Validation va error cases quan trong

### Username invalid

Response `400`:

```json
{
  "message": "username must be slug-style, for example dong-huu-trong."
}
```

### Missing Authorization

Response `401`:

```json
{
  "message": "Missing Authorization header."
}
```

### Bearer token sai format

Response `401`:

```json
{
  "message": "Authorization header must use Bearer token format."
}
```

### Token expired / invalid

Response `401`, message co the la:

- `Token is invalid.`
- `Token has expired.`
- `Token signature is invalid.`
- `Token claims are invalid.`

### Chua co profile

Response `404`:

```json
{
  "message": "Profile for the current user was not found."
}
```

### Entry khong ton tai

Response `404`:

```json
{
  "message": "Entry ot-001 was not found."
}
```

### Chua co active timer

Response `409`:

```json
{
  "message": "No active timer is running for this profile."
}
```

### Update timer khi chua co timer

Response `409`:

```json
{
  "message": "No active timer to update."
}
```

### Goi profile cua user khac

Response `403`:

```json
{
  "message": "You do not have access to profile dong-huu-trong."
}
```

Luu y:

- Neu backend khong dung `SUPABASE_SERVICE_ROLE_KEY`, trong mot so case Supabase RLS co the lam FE thay `404` thay vi `403`

## 11. Goi y luong tich hop cho FE

### Luong khoi dong app

1. FE login bang Supabase
2. FE goi `GET /api/me`
3. Neu `profile = null`, hien flow tao profile
4. FE goi `POST /api/profiles/me/init`
5. Sau do goi `GET /api/profiles/me`

### Luong man hinh OT

1. Goi `GET /api/profiles/me`
2. Goi `GET /api/profiles/me/entries?month=YYYY-MM`
3. Khi tao dong moi, goi `POST /api/profiles/me/entries`
4. Khi sua dong, goi `PUT /api/profiles/me/entries/:entryId`
5. Khi xoa dong, goi `DELETE /api/profiles/me/entries/:entryId`

### Luong timer

1. Goi `GET /api/profiles/me/timer`
2. Start: `POST /api/profiles/me/timer/start`
3. Update note: `PUT /api/profiles/me/timer`
4. Stop: `POST /api/profiles/me/timer/stop`
5. Sau khi stop xong, reload entries cua thang hien tai

## 12. Mau helper cho FE

```ts
async function apiFetch(path: string, options: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch(`http://localhost:3000${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) {
    return null;
  }

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.message || "Request failed.");
  }

  return body;
}
```

### Vi du lay profile hien tai

```ts
const profile = await apiFetch("/api/profiles/me");
```

### Vi du tao profile lan dau

```ts
await apiFetch("/api/profiles/me/init", {
  method: "POST",
  body: JSON.stringify({
    username: "dong-huu-trong",
  }),
});
```

### Vi du tao OT entry

```ts
await apiFetch("/api/profiles/me/entries", {
  method: "POST",
  body: JSON.stringify({
    date: "2026-05-13",
    startTime: "19:00",
    endTime: "21:00",
    note: "manual supabase check",
  }),
});
```

## 13. Luu y cuoi cung cho FE

- Uu tien dung route `/api/profiles/me*`
- Khong can goi backend bang Google token, chi dung Supabase access token
- Sau khi thay doi profile/entry/timer, FE nen refetch du lieu thay vi update local state qua nhieu lop
- `selectedMonth` duoc luu tren backend, FE co the dong bo state man hinh voi gia tri nay
- Dung `GET /api/me` de biet account dang login da co profile chua
