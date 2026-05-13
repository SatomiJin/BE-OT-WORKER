# FE-BE Auth Handoff

Tai lieu nay tong hop phan auth moi de FE dieu chinh theo contract cua backend.

## 1. Auth flow da chot

Flow hien tai:

1. FE login Google qua Supabase
2. FE nhan `access_token` cua Supabase session
3. FE gui token nay len backend qua header:

```http
Authorization: Bearer <access_token>
```

4. BE verify token local bang JWKS/signing keys cua Supabase
5. NEU token hop le thi request duoc di tiep vao API

BE KHONG goi `supabase.auth.getUser(token)` tren moi request nua.

## 2. Backend da thay doi gi

Backend da duoc cap nhat de:

- bat auth cho toan bo route `/api/*`
- giu `GET /health` la public
- verify local Supabase JWT bang JWKS endpoint
- khong phu thuoc remote call sang Supabase tren moi request
- them ownership check theo `request.auth.sub`
- them `GET /api/me` de FE doc context user dang login
- doc cac claim co ban tu token:
  - `sub`
  - `email`
  - `role`
- backend da chuyen phan persistence sang Supabase

## 3. Header FE bat buoc gui

Moi request vao API backend phai gui:

```http
Authorization: Bearer <Supabase access_token>
Content-Type: application/json
```

Neu khong gui `Authorization`, backend se tra:

```json
{
  "message": "Missing Authorization header."
}
```

Status code: `401`

## 4. FE can dung token nao

FE chi gui:

- `Supabase access_token`

FE KHONG can gui:

- Google ID token

Vi backend hien tai verify token session cua Supabase, khong verify truc tiep token cua Google.

## 5. Route nao can auth

Tat ca route duoi day deu can header `Authorization`:

- `GET /api/me`
- `GET /api/profiles/me`
- `POST /api/profiles/me/init`
- `PUT /api/profiles/me`
- `POST /api/profiles/me/entries`
- `PUT /api/profiles/me/entries/:entryId`
- `DELETE /api/profiles/me/entries/:entryId`
- `POST /api/profiles/me/timer/start`
- `PUT /api/profiles/me/timer`
- `POST /api/profiles/me/timer/stop`
- `POST /api/profiles`
- `GET /api/profiles/:username`
- `PUT /api/profiles/:username`
- `DELETE /api/profiles/:username`
- `GET /api/profiles/:username/entries`
- `POST /api/profiles/:username/entries`
- `PUT /api/profiles/:username/entries/:entryId`
- `DELETE /api/profiles/:username/entries/:entryId`
- `POST /api/profiles/:username/timer/start`
- `GET /api/profiles/:username/timer`
- `PUT /api/profiles/:username/timer`
- `POST /api/profiles/:username/timer/stop`

Route khong can auth:

- `GET /health`

## 6. Rule auth hien tai

Rule backend hien tai:

- token hop le la pass qua lop authentication
- profile duoc gan `authUserId = request.auth.sub` luc tao moi
- route `/api/profiles/me/*` luon resolve profile theo `request.auth.sub`
- moi route `/api/profiles/:username/*` se check profile do co `authUserId === request.auth.sub`
- neu token hop le nhung profile khong thuoc user do, backend tra `403`
- backend chua restrict domain email
- backend chua doi chieu user noi bo

Luu y:

- neu BE duoc cau hinh them `SUPABASE_SERVICE_ROLE_KEY`, ownership co the duoc phan biet ro rang giua `403` va `404`
- neu BE chi dung `SUPABASE_ANON_KEY` + user token duoi RLS, mot so truong hop goi profile cua nguoi khac co the nhin thay `404` thay vi `403`, vi row da bi Supabase an tu tang database

## 7. Cach lay access token ben FE

Sau khi login qua Supabase, FE can lay `access_token` tu session hien tai.

Y tuong chung:

```ts
const { data } = await supabase.auth.getSession();
const accessToken = data.session?.access_token;
```

Sau do gui vao backend:

```ts
await fetch("http://localhost:3000/api/profiles/dong-huu-trong", {
  method: "GET",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  },
});
```

## 8. Ky vong response khi test

### Truong hop 1: Co token hop le

Request qua duoc lop auth.

API se tra:

- `200` neu doc du lieu thanh cong
- `201` neu tao moi thanh cong
- `204` neu xoa thanh cong
- `404` neu resource khong ton tai
- `403` neu resource ton tai nhung khong thuoc user dang login

Luu y: `404` sau khi gui token hop le van la binh thuong, vi no cho thay auth da pass nhung du lieu khong ton tai.

### Truong hop 2: Khong gui token

Backend tra:

```json
{
  "message": "Missing Authorization header."
}
```

Status code: `401`

### Truong hop 3: Token sai format

Backend tra:

```json
{
  "message": "Authorization header must use Bearer token format."
}
```

Status code: `401`

### Truong hop 4: Token sai, expired, hoac signature khong hop le

Backend tra `401` voi mot trong cac message:

- `Token is invalid.`
- `Token has expired.`
- `Token signature is invalid.`
- `Token claims are invalid.`

### Truong hop 5: Token hop le nhung khong dung owner

Backend tra `403`, vi du:

```json
{
  "message": "You do not have access to profile dong-huu-trong."
}
```

## 9. CORS va browser request

Backend da cho phep header `Authorization` trong CORS va mac dinh allow origin `http://localhost:3026`.

FE chi can bao dam request browser co gui header:

```http
Authorization: Bearer <access_token>
```

## 10. Luu y de FE update

FE nen:

- luon lay token moi nhat tu Supabase session truoc khi goi API
- neu request bi `401`, co the trigger refresh session hoac yeu cau user login lai
- neu request bi `403`, coi nhu user dang goi sai profile business
- tach rieng wrapper call API de tu dong attach `Authorization`

## 11. Endpoint de FE test context user

Backend da co:

- `GET /api/me`

Response mau:

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

Neu user chua co profile duoc bind, `profile` se la `null`.

## 12. Backend config hien tai

BE da bat:

```env
SUPABASE_JWT_VERIFY=true
SUPABASE_URL=https://gwvjzrvycgppawwfhbkl.supabase.co
```

Issuer duoc suy ra mac dinh:

```txt
https://gwvjzrvycgppawwfhbkl.supabase.co/auth/v1
```

JWKS endpoint dung de verify local:

```txt
https://gwvjzrvycgppawwfhbkl.supabase.co/auth/v1/.well-known/jwks.json
```

## 13. Muc tieu cua thay doi nay

Huong nay giup:

- giam latency moi request
- khong phu thuoc remote call sang Supabase Auth tren moi API call
- de scale BE tot hon
- giu auth flow don gian cho FE: chi can gui `Supabase access_token`
- tranh user A doc/sua profile cua user B chi bang cach doi `username` tren URL
