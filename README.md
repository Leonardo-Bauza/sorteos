# Sorteos PokemonGo Caseros ✨

App web para hacer los sorteos de los eventos de la comunidad **Pokémon GO Caseros**. Trae a los asistentes de un evento de Campfire, te deja revisar la lista y sortea con suspenso, confeti y estrellitas.

- **Estática:** HTML, CSS y JavaScript sin frameworks, sin paso de build y sin dependencias.
- **Sin backend ni base de datos:** todo pasa en el navegador de quien sortea.
- **Instalable en el celular:** es una PWA, con ícono propio, y funciona sin internet en modo manual.
- **Sorteo justo:** usa `crypto.getRandomValues`, sin sesgo, y deja una auditoría completa.

---

## Cómo se usa

1. **Pegá el link del evento** de Campfire (por ejemplo `https://cmpf.re/…`) y tocá **Traer participantes**. Podés sumar varios eventos, uno por línea.
2. **Revisá la lista.**
   - Por defecto participan solo los que hicieron **check-in**, con **una entrada por persona** y **sin el creador** del evento. Las tres cosas se cambian con casillas.
   - Si alguien no tiene que participar, tocá **✕ Quitar**. Se puede volver a sumar desde "Quedan afuera".
   - En **🚫 Bloqueados** podés anotar gente que nunca participa. Esa lista queda guardada en el dispositivo.
   - Si aparece el aviso de **participantes sin nombre**, pediles que revisen su perfil o su check-in en Campfire y tocá **🔄 Volver a traer**. Si querés seguir igual, tildá **Ignorar participantes sin nombre**.
3. **Elegí premios y suplentes** y cómo revelarlos:
   - **Uno por uno:** con suspenso para cada premio.
   - **Todos juntos:** un "Top N" que se revela del último puesto al primero.
4. Tocá **🔒 Cerrar lista y sortear**. Desde ahí la lista ya no se puede tocar.
5. **¡Sorteá!** Si un ganador no está, tocá **Reemplazar**: entra el primer suplente o, si no hay, se sortea otro entre los que quedan.
6. **📋 Copiar resultados** o **📤 Compartir** te da el texto listo para WhatsApp o Discord. **⛶ Pantalla completa** sirve para proyectar o transmitir.

Si la API de Campfire no responde, usá la pestaña **📝 Lista manual**: pegás los nombres (uno por línea) y sorteás igual. Funciona sin internet.

### Instalarla en el celular

- **Android (Chrome):** abrí la página y tocá **📲 Instalar app** abajo de todo, o el menú ⋮ → *Instalar app*.
- **iPhone (Safari):** tocá **Compartir** → **Agregar a inicio**.

> **Importante en iPhone:** la app instalada guarda sus datos aparte de Safari. Cargá la lista de **bloqueados desde la app instalada**, no desde el navegador.

---

## Probarla en tu compu

Hace falta un **servidor estático**. Si abrís `index.html` con doble clic no funciona: los navegadores no cargan módulos de JavaScript (`import`) desde `file://`, por seguridad.

Con Python, que ya tenés instalado, parado en la carpeta del proyecto:

```bash
python -m http.server 8000
```

Abrí <http://localhost:8000>. Para cortarlo, `Ctrl + C`.

**Sobre la caché:** la app registra un *service worker* (ver más abajo). Como siempre intenta bajar la versión nueva primero, alcanza con recargar. Si algo quedó viejo, recargá con `Ctrl + Shift + R`.

**Para probar la subruta como en GitHub Pages**, servila desde la carpeta de arriba:

```bash
cd ..
python -m http.server 8000
# y abrí http://localhost:8000/<nombre-de-la-carpeta>/
```

### Tests

La lógica (links, API, filtros, sorteo, auditoría, almacenamiento) tiene tests con `node:test`. No usan dependencias ni llaman a la API real.

```bash
npm test
# o directamente: node --test
```

---

## Publicarla en GitHub Pages

### Qué es y por qué sirve acá

**GitHub Pages** publica gratis los archivos de un repositorio como sitio web, con **https** incluido. Como esta app es 100 % estática, no necesita nada más: GitHub entrega los archivos y todo lo demás pasa en el navegador de cada persona. El https además es obligatorio para que la app se pueda instalar en el celular.

### Paso a paso (repo nuevo)

1. **Creá un repositorio nuevo** en GitHub: <https://github.com/new>.
   - Nombre: por ejemplo `sorteos`. Va a ser parte de la URL.
   - Visibilidad: **Public**. Con una cuenta gratuita, GitHub Pages solo funciona en repos públicos. No hay nada secreto en el código: no tiene claves ni datos de participantes, y los tests usan datos inventados.
   - **No** marques "Add a README", ".gitignore" ni "license": ya están acá y generarían un conflicto.

2. **(Opcional) Poné tu nombre en los commits.** Este repo tiene configurada una identidad local (`ClaudeCode`). Si querés que los commits futuros salgan a tu nombre, desde la carpeta del proyecto:

   ```bash
   git config user.name "Tu Nombre"
   git config user.email "tu-email@ejemplo.com"
   ```

3. **Conectá la carpeta con el repo y subila.** GitHub te muestra estos comandos al crear el repo:

   ```bash
   git remote add origin https://github.com/<tu-usuario>/sorteos.git
   git push -u origin main
   ```

   La primera vez Git te va a pedir que inicies sesión en GitHub (se abre el navegador).

4. **Activá Pages.** En el repo, entrá a **Settings → Pages** y elegí:
   - **Source:** *Deploy from a branch*
   - **Branch:** `main` y carpeta `/ (root)` → **Save**

5. **Esperá uno o dos minutos.** El avance se ve en la pestaña **Actions**. La app queda en:

   ```
   https://<tu-usuario>.github.io/sorteos/
   ```

6. **Probala desde el celular**, instalala y pasale el link a quien vaya a sortear.

### ¿Y si ya tengo un dominio propio en GitHub Pages?

Si tu cuenta ya tiene un **sitio de usuario** (el repo `<tu-usuario>.github.io`) con un dominio propio configurado, GitHub publica automáticamente los repos de proyecto debajo de ese dominio. O sea, este repo aparecería en `https://tu-dominio/sorteos/` **sin tocar el repo del sitio principal**. Solo chocaría si tu sitio principal ya tiene una carpeta `/sorteos/`.

### La app funciona en una subruta

GitHub Pages sirve los repos de proyecto en una subruta (`/sorteos/`), así que todas las rutas de la app son **relativas** (`./css/…`, `./js/…`). El manifest y el service worker usan `./` como alcance. Está probado servido en `/sorteos/`.

El archivo vacío **`.nojekyll`** le dice a GitHub que entregue los archivos tal cual, sin pasarlos por Jekyll (su generador de sitios). Es más rápido y evita sorpresas con archivos que empiezan con `_`.

### Actualizar la app más adelante

```bash
git add -A
git commit -m "describí el cambio"
git push
```

GitHub vuelve a publicar en uno o dos minutos. **No hay que reinstalar nada en el celular**: la próxima vez que se abra la app con internet, baja la versión nueva sola. GitHub puede tardar hasta ~10 minutos en dejar de entregar la versión anterior desde su caché.

---

## Cómo funciona por dentro

### Datos

Los participantes vienen de la API pública de [cmpf-tools.de](https://cmpf-tools.de), el proyecto [campfire-tools](https://github.com/topi314/campfire-tools) de topi314:

```
GET https://cmpf-tools.de/api/events?events=<link o ID>
```

- La API permite pedidos desde cualquier sitio (`Access-Control-Allow-Origin: *`), así que **no hace falta un servidor intermedio**.
- La app hace **un pedido por evento**. Si se mandan varios juntos y uno falla, la API rechaza todos; separados se sabe exactamente qué link falló.
- Links aceptados: `cmpf.re/…`, `campfire.nianticlabs.com/discover/meetup/…`, `campfire.scopely.com/discover/meetup/…`, `niantic-social.nianticlabs.com/public/meetup/…` o el ID (UUID) suelto. Cualquier otro sitio se rechaza antes de llamar a la API.
- Los que **rechazaron** la invitación nunca participan. El mismo miembro puede venir repetido (por ejemplo "confirmó" y "check-in"): siempre se cuenta una sola vez por evento.

### Sorteo

- Los números al azar salen de `crypto.getRandomValues`, con *rejection sampling* para que todos tengan exactamente la misma probabilidad.
- "Uno por uno" y "Todos juntos" dan las mismas probabilidades. El ganador se decide **antes** de la animación: el rodillo de nombres es solo visual.
- Al cerrar la lista se calcula una **huella SHA-256** (`lista #xxxxxxxx`). Si alguien cierra la misma lista obtiene el mismo código, y si cambió una sola persona, el código cambia.
- La **auditoría** registra eventos, filtros, excluidos con su motivo, hora de cierre, el orden exacto en que salió cada uno y los reemplazos. Se puede descargar en JSON.

### Instalable (PWA) y sin internet

- `manifest.webmanifest` le dice al celular el nombre, los colores y los íconos.
- `sw.js` (*service worker*) usa la estrategia **"primero la red"**: con conexión baja siempre la última versión y guarda una copia; sin conexión abre la copia. Es ideal para una app que se usa una vez por mes, porque nunca queda vieja.
- Los pedidos a la API **no** pasan por el service worker ni se guardan.

### Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura de los tres pasos y diálogos |
| `css/styles.css` | Estilos mobile-first, tema oscuro, animaciones |
| `js/app.js` | Controlador de la interfaz |
| `js/links.js` | Valida links/UUIDs de Campfire |
| `js/api.js` | Cliente de cmpf-tools.de (timeout, errores en español) |
| `js/participants.js` | Filtros, bloqueados, revisión, cierre de lista, modo manual |
| `js/raffle.js` | Sorteo sin sesgo, suplentes, reemplazos, repetir |
| `js/audit.js` | Auditoría, huella y texto para WhatsApp/Discord |
| `js/storage.js` | Bloqueados y preferencias en `localStorage` |
| `js/text.js` | Limpieza de textos externos |
| `js/dom.js` | Helpers de DOM sin `innerHTML` |
| `js/reveal.js` | Rodillo de nombres, confeti y estrellitas |
| `js/pwa.js`, `sw.js`, `manifest.webmanifest` | App instalable |
| `icons/` | Íconos propios (SVG fuente y PNG) |
| `tests/` | Tests con `node:test` y datos inventados |

---

## Privacidad y seguridad

- **Los datos de los participantes no salen del navegador.** No hay servidor propio, base de datos, analytics ni cookies. La app no carga nada de terceros: ni fuentes ni scripts externos.
- En el dispositivo (`localStorage`) solo se guardan la **lista de bloqueados** y las **preferencias** (cantidad de premios, suplentes y modo). La lista de participantes no se guarda.
- La auditoría en JSON solo se descarga si tocás el botón, y queda en tu dispositivo.
- Todo lo que viene de la API o de la lista manual se inserta en la página como **texto** (`textContent`), nunca como HTML. Un nombre como `<img onerror=…>` se ve literal y no se ejecuta.
- **Content Security Policy:** la página solo ejecuta sus propios scripts y estilos, y solo se puede conectar con `cmpf-tools.de`.
- Los pedidos a la API van sin cookies (`credentials: 'omit'`) y sin *referrer*. Los links externos abren con `noopener noreferrer`.
- Hay topes para entradas enormes: largo de los cuadros de texto, cantidad de líneas en modo manual y cantidad de miembros por evento.
- Sin dependencias, así que no hay riesgo de paquetes de terceros comprometidos.

**Limitaciones conocidas:**
- La app depende de que cmpf-tools.de siga funcionando y permitiendo pedidos desde el navegador. Si deja de andar, queda el modo manual.
- GitHub Pages no permite configurar headers, así que no se puede impedir que otro sitio muestre la app dentro de un *iframe*. Para esta app el riesgo es bajo, porque no maneja cuentas ni datos sensibles.

---

## Créditos y aviso legal

- Comunidad **Pokémon GO Caseros**. No afiliado a Niantic, Nintendo, Creatures ni The Pokémon Company.
- Datos vía [cmpf-tools.de](https://cmpf-tools.de) ([topi314](https://github.com/topi314/campfire-tools)).
- Íconos y gráficos propios: no usa logos, sprites, personajes ni arte oficial.
