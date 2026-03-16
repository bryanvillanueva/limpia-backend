# Imágenes de insumos (supplies) con Cloudinary

## Objetivo

Subir imágenes de insumos a [Cloudinary](https://cloudinary.com/documentation/) y guardar la URL en `supplies.imagen_url` para que el frontend pueda mostrarlas.

## Configuración backend (env)

Configurar Cloudinary con **una** de estas opciones:

**Opción 1 – Variable única (recomendada)**  
En `.env`:

```
CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
```

Obtener los valores en [Cloudinary API Keys](https://console.cloudinary.com/app/settings/api-keys).

**Opción 2 – Variables separadas**

```
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret
```

## Endpoints

### 1. Subir solo imagen (obtener URL)

- **Método:** `POST`
- **URL:** `/api/supplies/upload-image`
- **Auth:** JWT
- **Roles:** `admin`, `manager`
- **Content-Type:** `multipart/form-data`
- **Campo:** `image` (archivo: JPEG, PNG, GIF, WebP; máx. 5 MB)

**Respuesta 201:**

```json
{
  "imagen_url": "https://res.cloudinary.com/..."
}
```

El frontend puede usar `imagen_url` en el body de create/update o mostrarla en un preview.

### 2. Crear insumo con imagen (opcional)

- **Método:** `POST`
- **URL:** `/api/supplies`
- **Auth:** JWT. Roles: `admin`, `manager`
- **Content-Type:** `multipart/form-data` o `application/json`

**Campos (form-data o JSON):**

- `nombre` (requerido)
- `descripcion`, `unidad`, `stock_actual`, `stock_minimo`, `precio_unitario`, `proveedor_id`
- `imagen_url` (opcional si se envía archivo)
- **Archivo opcional:** campo `image` (imagen). Si se envía, se sube a Cloudinary y se guarda la URL en `imagen_url`.

Si se envía `image`, el backend ignora `imagen_url` del body y usa la URL devuelta por Cloudinary.

### 3. Actualizar insumo (imagen opcional)

- **Método:** `PUT`
- **URL:** `/api/supplies/:id`
- **Content-Type:** `multipart/form-data` o `application/json`
- **Archivo opcional:** campo `image`. Si se envía, se sube a Cloudinary y se actualiza `imagen_url`.

## Cómo usar en el frontend

### Opción A: Subir imagen y luego crear/actualizar

1. Subir imagen:
   ```js
   const formData = new FormData();
   formData.append('image', file); // File from <input type="file" accept="image/*" />
   const res = await fetch('/api/supplies/upload-image', {
     method: 'POST',
     headers: { Authorization: `Bearer ${token}` },
     body: formData
   });
   const { imagen_url } = await res.json();
   ```
2. Crear o actualizar insumo con esa URL:
   ```js
   await fetch('/api/supplies', {
     method: 'POST',
     headers: {
       Authorization: `Bearer ${token}`,
       'Content-Type': 'application/json'
     },
     body: JSON.stringify({ nombre: '...', imagen_url, ... })
   });
   ```

### Opción B: Crear/actualizar en una sola petición con imagen

```js
const formData = new FormData();
formData.append('nombre', 'Nombre del insumo');
formData.append('descripcion', '...');
formData.append('unidad', 'unidad');
formData.append('stock_actual', '10');
formData.append('stock_minimo', '5');
formData.append('precio_unitario', '2.50');
formData.append('proveedor_id', '1'); // opcional
formData.append('image', file); // File

const res = await fetch('/api/supplies', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: formData
});
// No enviar Content-Type; el navegador fija multipart/form-data con boundary
```

### Mostrar la imagen en la UI

El campo `imagen_url` de cada insumo es la URL pública de Cloudinary. Usar directamente en `<img>`:

```jsx
{supply.imagen_url ? (
  <img src={supply.imagen_url} alt={supply.nombre} />
) : (
  <span>Sin imagen</span>
)}
```

## Base de datos

En la tabla `supplies`, el campo `imagen_url` (TEXT) guarda la URL segura devuelta por Cloudinary (ej. `https://res.cloudinary.com/...`). No se guardan archivos en disco en el backend.

## Límites

- Formatos: JPEG, PNG, GIF, WebP.
- Tamaño máximo por archivo: 5 MB.
- Las imágenes se suben al folder `limpia/supplies` en Cloudinary (para orden en la consola).
