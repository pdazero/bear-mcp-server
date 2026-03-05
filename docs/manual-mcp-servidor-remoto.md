# Manual: Servidor MCP Remoto en MacBook Pro 2017

**Objetivo:** Configurar el MacBook Pro 2017 Intel (enchufado 24/7 en la casa) como servidor MCP remoto para OmniFocus y Bear Notes, accesible desde Claude en cualquier lugar.

**Resultado final:** Claude (desde claude.ai, Claude Desktop, o Claude Code) podrá leer y escribir en tu OmniFocus y Bear Notes a través de internet, con 4 capas de seguridad.

---

## Prerrequisitos

Antes de empezar, verificar que tienes:

- [ ] MacBook Pro 2017 enchufado y encendido
- [ ] macOS Ventura (13) instalado (es el máximo para este modelo)
- [ ] OmniFocus 4 instalado y sincronizando con Omni Sync Server
- [ ] Bear Notes instalado y sincronizando con iCloud
- [ ] Acceso de administrador al router de la casa
- [ ] Dominio DynDNS configurado (tu-dominio.dyndns.org)
- [ ] Cuenta en el plan Pro/Max/Team de Claude (para remote MCP)

---

## Parte 1 — Preparar el MacBook Pro como servidor

### Paso 1.1: Revisar la batería

**⚠️ IMPORTANTE — Hacer esto primero.**

La batería lleva años enchufada 24/7 y puede estar hinchada (riesgo de incendio).

```bash
# Verificar estado de la batería
system_profiler SPPowerDataType | grep -A 5 "Health Information"
```

Si dice "Service Recommended" o "Replace Now", llévalo a un servicio técnico Apple para que retiren la batería. El MacBook funciona perfectamente sin batería mientras esté enchufado.

### Paso 1.2: Actualizar a macOS Ventura

```bash
# Verificar versión actual
sw_vers
```

Si no está en Ventura (13.x), actualizarlo desde System Settings → General → Software Update. OmniFocus 4 requiere al menos Ventura.

### Paso 1.3: Configurar como servidor "always-on"

```bash
# Desactivar sleep completamente
sudo pmset -a sleep 0
sudo pmset -a disksleep 0
sudo pmset -a displaysleep 5    # pantalla se apaga en 5 min pero Mac sigue activo

# Reinicio automático tras corte de luz
sudo pmset -a autorestart 1

# Verificar configuración
pmset -g
```

### Paso 1.4: Configurar login automático

1. Abrir **System Settings → Users & Groups**
2. Hacer clic en el candado para desbloquear
3. Activar **Automatic Login** para tu usuario
4. Ingresar contraseña

> Nota: Si FileVault está activado, el login automático no funciona. Para un servidor casero, puedes desactivar FileVault en System Settings → Privacy & Security → FileVault.

### Paso 1.5: Activar acceso remoto

1. **System Settings → General → Sharing**
2. Activar **Remote Login** (SSH)
3. Anotar la IP local que aparece (ej: `192.168.1.50`)

Probar desde otro dispositivo en la misma red:

```bash
ssh tu-usuario@192.168.1.50
```

### Paso 1.6: Agregar apps a Login Items

1. **System Settings → General → Login Items**
2. Agregar:
   - OmniFocus
   - Bear

Esto asegura que ambas apps arranquen automáticamente al encender el Mac.

### Paso 1.7: Asignar IP local fija

Para que el port forwarding del router funcione consistentemente:

1. **System Settings → Network → Wi-Fi (o Ethernet) → Details → TCP/IP**
2. Cambiar "Configure IPv4" a **Manually**
3. Configurar:
   - IP Address: `192.168.1.50` (o la que prefieras, fuera del rango DHCP)
   - Subnet Mask: `255.255.255.0`
   - Router: `192.168.1.1` (la IP de tu router)
4. En **DNS**, agregar: `8.8.8.8` y `8.8.4.4`

> Alternativa: Configurar DHCP reservation en el router para la MAC address del MacBook.

---

## Parte 2 — Instalar herramientas base

### Paso 2.1: Instalar Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Seguir las instrucciones post-instalación para agregar Homebrew al PATH.

### Paso 2.2: Instalar Node.js

```bash
brew install node@20
```

Verificar:

```bash
node --version   # Debe ser v20.x o superior
npm --version
```

### Paso 2.3: Instalar Caddy

```bash
brew install caddy
```

Verificar:

```bash
caddy version
```

### Paso 2.4: Instalar cliente DynDNS

```bash
brew install ddclient
```

Crear archivo de configuración:

```bash
sudo mkdir -p /usr/local/etc
sudo nano /usr/local/etc/ddclient.conf
```

Contenido (ajustar con tus datos):

```
daemon=300                    # verificar cada 5 minutos
protocol=dyndns2
use=web, web=checkip.dyndns.org
server=members.dyndns.org
login=TU_USUARIO_DYNDNS
password='TU_PASSWORD_DYNDNS'
tu-dominio.dyndns.org
```

Iniciar como servicio:

```bash
brew services start ddclient
```

Verificar que funciona:

```bash
# Esperar unos minutos, luego:
nslookup tu-dominio.dyndns.org
# Debe mostrar tu IP pública actual
```

---

## Parte 3 — Instalar y configurar MCP Servers

### Paso 3.1: Crear directorio de trabajo

```bash
mkdir -p ~/mcp-servers
cd ~/mcp-servers
```

### Paso 3.2: Instalar omnifocus-mcp-enhanced

```bash
npm install -g omnifocus-mcp-enhanced
```

Probar que funciona localmente:

```bash
# Ejecutar en modo stdio para verificar
npx omnifocus-mcp-enhanced
# Debería arrancar sin errores. Ctrl+C para salir.
```

### Paso 3.3: Otorgar permisos de Automation

La primera vez que el MCP server intente comunicarse con OmniFocus, macOS pedirá permiso.

1. **System Settings → Privacy & Security → Automation**
2. Buscar **Terminal** (o el proceso de Node)
3. Activar permiso para controlar **OmniFocus**

Si no aparece automáticamente, ejecutar manualmente:

```bash
osascript -l JavaScript -e 'Application("OmniFocus").defaultDocument.flattenedTasks().length'
```

Esto fuerza el diálogo de permisos. Debe devolver un número (la cantidad de tareas).

### Paso 3.4: Instalar bear-notes-mcp (tu fork)

```bash
# Ajustar según la ubicación de tu fork
cd ~/mcp-servers
git clone https://github.com/TU_USUARIO/bear-mcp-server.git
cd bear-mcp-server
npm install
npm run build
```

### Paso 3.5: Crear wrapper scripts para modo HTTP/SSE

Los MCP servers por defecto usan stdio. Para acceso remoto necesitan escuchar en HTTP. Crear wrappers que los expongan con transporte SSE/Streamable HTTP.

**Opción A — Usar `mcp-remote` o `supergateway`:**

```bash
npm install -g @anthropic-ai/mcp-remote
# o
npm install -g supergateway
```

**Wrapper para OmniFocus (puerto 3001):**

Crear archivo `~/mcp-servers/start-omnifocus-mcp.sh`:

```bash
#!/bin/bash
# Wrapper para exponer omnifocus-mcp-enhanced via HTTP en puerto 3001
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
cd ~/mcp-servers

npx supergateway \
  --port 3001 \
  --host 127.0.0.1 \
  --stdio "npx omnifocus-mcp-enhanced"
```

```bash
chmod +x ~/mcp-servers/start-omnifocus-mcp.sh
```

**Wrapper para Bear Notes (puerto 3002):**

Crear archivo `~/mcp-servers/start-bear-mcp.sh`:

```bash
#!/bin/bash
# Wrapper para exponer bear-notes-mcp via HTTP en puerto 3002
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
cd ~/mcp-servers/bear-mcp-server

npx supergateway \
  --port 3002 \
  --host 127.0.0.1 \
  --stdio "node dist/index.js"
```

```bash
chmod +x ~/mcp-servers/start-bear-mcp.sh
```

### Paso 3.6: Probar los servidores localmente

En terminales separadas:

```bash
# Terminal 1
~/mcp-servers/start-omnifocus-mcp.sh

# Terminal 2
~/mcp-servers/start-bear-mcp.sh
```

Verificar que responden:

```bash
curl http://127.0.0.1:3001/sse
curl http://127.0.0.1:3002/sse
```

Deberían devolver un stream SSE (o un endpoint de negociación MCP). Ctrl+C para detener las pruebas.

---

## Parte 4 — Configurar Caddy como reverse proxy

### Paso 4.1: Crear Caddyfile

Crear archivo `~/mcp-servers/Caddyfile`:

```
{
    # Email para Let's Encrypt
    email tu-email@example.com
}

tu-dominio.dyndns.org:8443 {
    # Capa 3: Token de autenticación
    @authorized {
        header Authorization "Bearer TU_TOKEN_SECRETO_AQUI"
    }

    # Rechazar requests sin token válido
    handle {
        @unauthorized not header Authorization "Bearer TU_TOKEN_SECRETO_AQUI"
        respond @unauthorized "Unauthorized" 401
    }

    # Ruteo a MCP servers
    handle /omnifocus/* {
        uri strip_prefix /omnifocus
        reverse_proxy 127.0.0.1:3001
    }

    handle /bear/* {
        uri strip_prefix /bear
        reverse_proxy 127.0.0.1:3002
    }

    # Log para debugging
    log {
        output file /var/log/caddy/access.log
        format console
    }
}
```

### Paso 4.2: Generar un token seguro

```bash
# Generar un token aleatorio de 64 caracteres
openssl rand -hex 32
```

Copiar el resultado y reemplazar `TU_TOKEN_SECRETO_AQUI` en el Caddyfile (en ambas apariciones).

> **IMPORTANTE:** Guardar este token en un lugar seguro. Lo necesitarás al configurar Claude.

### Paso 4.3: Crear directorio de logs

```bash
sudo mkdir -p /var/log/caddy
sudo chown $(whoami) /var/log/caddy
```

### Paso 4.4: Probar Caddy

```bash
cd ~/mcp-servers
caddy run --config Caddyfile
```

Si hay errores de certificado TLS (porque DynDNS aún no apunta a esta IP, o el puerto 443 no está abierto para el challenge ACME), ver la sección de Troubleshooting.

---

## Parte 5 — Configurar el router

### Paso 5.1: Port forwarding

Acceder al panel de administración del router (generalmente `http://192.168.1.1`).

Crear regla de port forwarding:

| Campo | Valor |
|---|---|
| Nombre | MCP-Server |
| Puerto externo | 8443 |
| Puerto interno | 8443 |
| IP destino | 192.168.1.50 (la IP fija del MacBook) |
| Protocolo | TCP |

### Paso 5.2: Firewall — Whitelist de IPs de Anthropic

Esta es la capa de seguridad más importante. Solo Anthropic puede alcanzar tu servidor.

En la configuración de firewall del router, crear regla:

| Campo | Valor |
|---|---|
| Acción | ALLOW |
| IP origen | `160.79.104.0/21` |
| Puerto destino | 8443 |
| Protocolo | TCP |

Y una regla por defecto:

| Campo | Valor |
|---|---|
| Acción | DENY |
| IP origen | Cualquiera |
| Puerto destino | 8443 |
| Protocolo | TCP |

> **Nota:** La configuración exacta varía según el modelo de router. Si tu router no soporta filtrado por IP origen en port forwarding, puedes implementar el filtrado con `pf` (el firewall de macOS) directamente en el MacBook. Ver sección de Troubleshooting.

### Paso 5.3: Abrir puerto 80 temporalmente para Let's Encrypt

Caddy necesita el puerto 80 abierto temporalmente para el challenge ACME de Let's Encrypt (obtener el certificado TLS).

Crear port forwarding temporal:

| Campo | Valor |
|---|---|
| Puerto externo | 80 |
| Puerto interno | 80 |
| IP destino | 192.168.1.50 |

Una vez que Caddy obtenga el certificado (se verá en los logs), puedes cerrar el puerto 80. Caddy renueva certificados automáticamente usando TLS-ALPN en el puerto 8443.

> **Alternativa:** Si no quieres abrir el puerto 80, puedes usar el challenge DNS de Let's Encrypt con un plugin de Caddy para DynDNS.

---

## Parte 6 — Configurar arranque automático (LaunchAgents)

### Paso 6.1: LaunchAgent para OmniFocus MCP

Crear archivo `~/Library/LaunchAgents/com.mcp.omnifocus.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mcp.omnifocus</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>~/mcp-servers/start-omnifocus-mcp.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/mcp-omnifocus.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mcp-omnifocus-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

### Paso 6.2: LaunchAgent para Bear MCP

Crear archivo `~/Library/LaunchAgents/com.mcp.bearnotes.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mcp.bearnotes</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>~/mcp-servers/start-bear-mcp.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/mcp-bearnotes.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mcp-bearnotes-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

### Paso 6.3: LaunchAgent para Caddy

Crear archivo `~/Library/LaunchAgents/com.mcp.caddy.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mcp.caddy</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/caddy</string>
        <string>run</string>
        <string>--config</string>
        <string>/Users/TU_USUARIO/mcp-servers/Caddyfile</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/mcp-caddy.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mcp-caddy-error.log</string>
</dict>
</plist>
```

> **IMPORTANTE:** Reemplazar `TU_USUARIO` con tu nombre de usuario de macOS. También verificar la ruta de Caddy con `which caddy`.

### Paso 6.4: Cargar los LaunchAgents

```bash
launchctl load ~/Library/LaunchAgents/com.mcp.omnifocus.plist
launchctl load ~/Library/LaunchAgents/com.mcp.bearnotes.plist
launchctl load ~/Library/LaunchAgents/com.mcp.caddy.plist
```

Verificar que están corriendo:

```bash
launchctl list | grep mcp
```

Deben aparecer los tres con PID (no `-`).

---

## Parte 7 — Configurar Claude para usar los MCP servers

### Paso 7.1: En Claude Desktop (macOS)

Editar `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "omnifocus-remoto": {
      "type": "sse",
      "url": "https://tu-dominio.dyndns.org:8443/omnifocus/sse",
      "headers": {
        "Authorization": "Bearer TU_TOKEN_SECRETO_AQUI"
      }
    },
    "bear-remoto": {
      "type": "sse",
      "url": "https://tu-dominio.dyndns.org:8443/bear/sse",
      "headers": {
        "Authorization": "Bearer TU_TOKEN_SECRETO_AQUI"
      }
    }
  }
}
```

### Paso 7.2: En Claude Code (CLI)

```bash
# OmniFocus
claude mcp add --transport http omnifocus-remoto \
  https://tu-dominio.dyndns.org:8443/omnifocus/sse \
  --header "Authorization: Bearer TU_TOKEN_SECRETO_AQUI"

# Bear Notes
claude mcp add --transport http bear-remoto \
  https://tu-dominio.dyndns.org:8443/bear/sse \
  --header "Authorization: Bearer TU_TOKEN_SECRETO_AQUI"
```

### Paso 7.3: En claude.ai (web/móvil)

Para remote MCP en claude.ai (requiere plan Pro/Max/Team/Enterprise):

1. Ir a **Settings → Connectors**
2. Agregar **Custom Connector**
3. URL: `https://tu-dominio.dyndns.org:8443/omnifocus/`
4. Repetir para Bear: `https://tu-dominio.dyndns.org:8443/bear/`

> **Nota:** La configuración exacta de custom connectors en claude.ai puede variar. Consultar la documentación actualizada en https://support.claude.com

---

## Parte 8 — Verificación completa

### Paso 8.1: Verificar la cadena completa desde fuera de la red

Desde el celular (usando datos móviles, NO WiFi de casa):

```bash
# Test 1: DNS resuelve correctamente
nslookup tu-dominio.dyndns.org

# Test 2: Puerto accesible (solo funcionará desde IPs de Anthropic por el whitelist)
# Desde tu celular esto DEBERÍA fallar (eso confirma que el whitelist funciona)
curl -v https://tu-dominio.dyndns.org:8443/
```

### Paso 8.2: Verificar desde Claude

Abrir Claude Desktop o claude.ai y probar:

```
"Muéstrame las tareas de mi inbox en OmniFocus"
"Busca en mis notas de Bear algo sobre RISPAC"
"Crea una tarea en OmniFocus: Revisar batería MacBook Pro"
```

### Paso 8.3: Verificar logs

```bash
# Logs de Caddy
tail -f /var/log/caddy/access.log

# Logs de MCP servers
tail -f /tmp/mcp-omnifocus.log
tail -f /tmp/mcp-bearnotes.log

# Logs de errores
tail -f /tmp/mcp-omnifocus-error.log
tail -f /tmp/mcp-bearnotes-error.log
```

---

## Troubleshooting

### El router no soporta filtrado por IP origen

Usar `pf` (el firewall nativo de macOS) en el MacBook Pro:

```bash
# Crear archivo de reglas
sudo nano /etc/pf.anchors/mcp-whitelist
```

Contenido:

```
# Solo permitir tráfico MCP desde IPs de Anthropic
pass in on en0 proto tcp from 160.79.104.0/21 to any port 8443
block in on en0 proto tcp from any to any port 8443
```

Activar:

```bash
# Agregar anchor al pf.conf
echo 'anchor "mcp-whitelist"' | sudo tee -a /etc/pf.conf
echo 'load anchor "mcp-whitelist" from "/etc/pf.anchors/mcp-whitelist"' | sudo tee -a /etc/pf.conf

# Recargar
sudo pfctl -f /etc/pf.conf
sudo pfctl -e
```

### Let's Encrypt no puede obtener certificado

Si no puedes abrir el puerto 80 para el challenge ACME:

1. Usar certificados auto-firmados temporalmente (agregar `tls internal` en Caddyfile)
2. O usar challenge DNS con plugin de Caddy para tu proveedor DNS
3. O usar Caddy con challenge TLS-ALPN (requiere que el puerto 443 o tu puerto custom esté accesible)

### OmniFocus no responde a JXA

```bash
# Verificar que OmniFocus está corriendo
pgrep -l OmniFocus

# Si no está corriendo, abrirlo
open -a "OmniFocus"

# Probar JXA manualmente
osascript -l JavaScript -e 'Application("OmniFocus").defaultDocument.flattenedTasks().length'
```

Si da error de permisos:
1. **System Settings → Privacy & Security → Automation**
2. Buscar Terminal (o la app que ejecuta el script)
3. Activar permiso para OmniFocus

### Los LaunchAgents no arrancan

```bash
# Ver estado detallado
launchctl print gui/$(id -u)/com.mcp.omnifocus

# Si muestra error, verificar paths
launchctl unload ~/Library/LaunchAgents/com.mcp.omnifocus.plist
launchctl load ~/Library/LaunchAgents/com.mcp.omnifocus.plist

# Verificar que el script tiene permisos de ejecución
ls -la ~/mcp-servers/start-omnifocus-mcp.sh
```

### Los niños cierran las apps

Los LaunchAgents con `KeepAlive: true` reinician los MCP servers automáticamente. Para OmniFocus y Bear, están en Login Items así que se reabren al hacer login. Si los niños cierran las apps manualmente, los MCP servers fallarán hasta que se reabran.

Para mayor robustez, crear un script watchdog:

```bash
#!/bin/bash
# ~/mcp-servers/watchdog.sh
# Verificar cada 60 segundos que las apps necesarias están corriendo

while true; do
    pgrep -q "OmniFocus" || open -a "OmniFocus"
    pgrep -q "Bear" || open -a "Bear"
    sleep 60
done
```

Y crear un LaunchAgent para el watchdog con `KeepAlive: true`.

### DynDNS no actualiza la IP

```bash
# Verificar IP pública actual
curl ifconfig.me

# Verificar qué IP tiene el dominio
nslookup tu-dominio.dyndns.org

# Forzar actualización
sudo ddclient -force
```

---

## Resumen de puertos y servicios

| Servicio | Puerto | Acceso |
|---|---|---|
| OmniFocus MCP | 3001 (localhost) | Solo interno |
| Bear Notes MCP | 3002 (localhost) | Solo interno |
| Caddy (HTTPS) | 8443 (público) | Solo IPs Anthropic: 160.79.104.0/21 |
| SSH | 22 (local) | Solo red local (o Tailscale) |

## Resumen de archivos creados

| Archivo | Propósito |
|---|---|
| `~/mcp-servers/start-omnifocus-mcp.sh` | Wrapper HTTP para OmniFocus MCP |
| `~/mcp-servers/start-bear-mcp.sh` | Wrapper HTTP para Bear MCP |
| `~/mcp-servers/Caddyfile` | Configuración del reverse proxy |
| `~/Library/LaunchAgents/com.mcp.omnifocus.plist` | Autostart OmniFocus MCP |
| `~/Library/LaunchAgents/com.mcp.bearnotes.plist` | Autostart Bear MCP |
| `~/Library/LaunchAgents/com.mcp.caddy.plist` | Autostart Caddy |
| `/usr/local/etc/ddclient.conf` | Configuración DynDNS |

## Capas de seguridad (resumen)

1. **Whitelist IP** — Solo `160.79.104.0/21` (Anthropic) puede llegar al puerto 8443
2. **TLS/HTTPS** — Certificado Let's Encrypt, todo el tráfico cifrado
3. **Token Bearer** — API key en header Authorization, validado por Caddy
4. **Puerto no estándar** — 8443 reduce escaneos automáticos de bots
