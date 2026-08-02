# SmartWAN Manager for ASUS RT-N18U

[English](#english) · [Polski](#polski) · [Firmware installation note](https://github.com/hattimon/asuswrt-rtn18u/tree/master) · [Upstream firmware](https://github.com/gzenux/asuswrt-rtn18u)

Local, bilingual administration panel for SmartWAN and Dual WAN on ASUS RT-N18U. The panel runs in Docker on a Raspberry Pi, Ubuntu Server, a Linux PC, or WSL 2 and manages the router over SSH.

> Firmware dependency: SmartWAN Manager was created for ASUS RT-N18U running the unofficial [gzenux/asuswrt-rtn18u](https://github.com/gzenux/asuswrt-rtn18u) Asuswrt-Merlin line, version `386.3_3`. The panel does not install or upgrade router firmware. Read the [firmware installation note](https://github.com/hattimon/asuswrt-rtn18u/tree/master) and prepare the router before installing SmartWAN Manager.

![Aurelka WAN status legend](docs/aurelka-status.svg)

## English

### What the panel does

SmartWAN Manager keeps the ASUS router as the routing backend and adds a safer, more readable management layer:

- administrative dashboard with router identity, firmware, uptime, RAM, JFFS storage, SSH state, SmartWAN daemon state, WAN health, logs, and route summaries;
- read-only network map with active LAN clients, device type, current-device route, VPN state, and WAN event history;
- guided router setup with live model/firmware detection, change preview, automatic local backup, and explicit apply confirmation;
- SmartWAN configuration and router-side presets;
- native ASUS Dual WAN configuration, load-balance/failover mode, ratios, and routing rules;
- per-device, per-subnet, destination CIDR, and domain/service routing;
- reusable service-routing groups, JSON import/export, rule validation, and optional AI-assisted rule generation;
- optional Google WAN country/location monitoring and automatic temporary service routing;
- router-side watchdog, failure confirmation, automatic failover, recovery confirmation, and return to normal routing;
- WAN-aware managed DMZ with symmetric return routing and configurable outage behavior;
- OpenVPN Server 1 and Server 2 policy, profile editor, profile download, LAN/router/Internet access, NAT, and preferred-WAN failover;
- optional Tailscale subnet-router access and optional exit-node advertisement;
- optional Cloudflare DDNS synchronization for a selected OpenVPN server and WAN;
- Ed25519 key generation (built in or with [hattimon/ssh-key-forge](https://github.com/hattimon/ssh-key-forge)), router host-key inspection, SSH password/key authentication, and Merlin script installation;
- full and SmartWAN-only backups, restore preview, safety backup, and restore confirmation;
- persistent WAN failure/recovery archive, live quality tests, routing diagnostics, and conflict warnings;
- Safe, Basic, Advanced, and Expert interface modes;
- English and Polish UI.

The default SmartWAN watchdog values are:

| Setting | Default |
|---|---:|
| Probe interval | 1 second |
| Failed probes before failover | 2 |
| Successful probes before return | 3 |

These defaults favor quick switching. Increase the interval or counters on unstable links to avoid unnecessary failovers.

### What continues to run without the panel

Most applied settings live on the router. SmartWAN rules and presets, the router-side watchdog and failover, managed VPN/DMZ policy, and Merlin hooks continue after the Docker container is stopped.

The container must remain running for container-side services: scheduled WAN country/location checks, Cloudflare DDNS, Tailscale access, copying the router's bounded RAM event journal into persistent storage, the public status/network map, and Aurelka notifications. The router still routes traffic when those panel-side services are unavailable.

### Login screen

There is no factory panel password. After the first start, set one from the installation host:

```sh
docker compose exec smartwan-manager node server/setPanelPassword.js admin 'replace-with-a-strong-password'
```

The login page provides:

- username and password authentication;
- a signed, `HttpOnly`, `SameSite=Lax` session lasting up to 12 hours;
- a password-reset command that must be run locally or through SSH on the panel host;
- Polish/English selection;
- sound and animation controls for Aurelka;
- an expandable read-only connection summary;
- a read-only network-map preview and VPN download area for clients from configured trusted LAN/VPN subnets.

Keep the panel on a trusted network. If a reverse proxy is used, configure `SMARTWAN_TRUSTED_PROXIES` narrowly and make the proxy replace untrusted forwarding headers.

### Aurelka — guardian of both WAN links

Aurelka's left and right eyes represent `wan0` and `wan1` independently:

| Eyes | Meaning | Behaviour and notifications |
|---|---|---|
| Green | The represented WAN is healthy | Aurelka is calm; the status bubble reports that all links are working. |
| Orange | The panel is reading status, data is stale/missing, or a failed WAN is in recovery confirmation | Eyes pulse while Aurelka checks the links; the bulb uses warning orange. |
| One red, one green | One WAN is down and the other remains available | Aurelka becomes alert, identifies the failed WAN, meows twice, then repeats every 30 seconds while the outage continues. |
| Both red | Both WAN links are down | Red alarm state, angry animation, danger bulb, and repeated audible alert when sound is enabled. |

The bulb pulses when WAN state changes or a new local Aurelka message arrives. Browsers may delay sound until the first user interaction. Aurelka can be clicked to show status and the five newest local messages, dragged around the login page, double-clicked to resume her route, muted, or paused. Messages are stored in the private Docker data volume, are rate-limited, and are available only through the trusted-network public endpoints.

### Suggested requirements

| Component | Practical minimum | Recommended |
|---|---|---|
| Raspberry Pi | Pi 3B+, 64-bit OS, 1 GB RAM plus swap | Pi 4/5, 2 GB+ RAM, Raspberry Pi OS Lite 64-bit or Ubuntu Server 64-bit |
| PC / mini PC / VM | 1 x86-64/ARM64 CPU, 1 GB RAM | 2 CPU threads, 2 GB RAM |
| Storage | 1 GB free | 2 GB+ free for image layers, builds, backups, and event history |
| Network | Stable LAN and SSH reachability to the router | Wired Ethernet and a fixed/reserved address for the panel host |
| Software | Linux, Docker Engine, Compose v2, Git | Current 64-bit Linux and current Docker/Compose releases |

Router requirements:

- ASUS RT-N18U with firmware `386.3_3` from [gzenux/asuswrt-rtn18u](https://github.com/gzenux/asuswrt-rtn18u);
- SSH enabled;
- JFFS custom scripts/configs enabled;
- preferably SSH key authentication;
- panel host able to reach the router's SSH port;
- Docker host port `8888/TCP` available, or another port selected in `.env`.

Optional features need outbound access to their providers. Tailscale additionally needs `/dev/net/tun`, `NET_ADMIN`, `NET_RAW`, and IP forwarding.

### Prepare the router firmware first

SmartWAN Manager is an extension of the unofficial Asuswrt-Merlin RT-N18U firmware; it is not a firmware installer. The supported firmware must already be running before the panel connects to the router and deploys SmartWAN configuration.

Follow this order:

1. Read the complete [RT-N18U firmware installation note](https://github.com/hattimon/asuswrt-rtn18u/tree/master) and back up the current router configuration.
2. If the router still runs official AsusWRT, first upgrade the official firmware to `3.0.0.4.382.52288`. This is the preparation baseline stated by the firmware project.
3. Upload the unofficial Asuswrt-Merlin RT-N18U firmware `386.3_3` through the ASUS web interface. Firmware installation is performed separately from SmartWAN Manager and at the router owner's risk.
4. After switching from official AsusWRT to this firmware, restore factory defaults with the router's hardware reset button. Configure the router again from a clean state; do not restore a settings backup created under a different firmware version.
5. Enable SSH and **JFFS custom scripts and configs** in the router interface. Only then install SmartWAN Manager, test its SSH connection and use the setup wizard or **Scripts** section.

At the final stage SmartWAN Manager uses SSH to place its managed scripts, configuration, presets and Merlin hook blocks on JFFS, then applies the selected routing settings. It never replaces the firmware image, bootloader or firmware-upgrade procedure. Keep a current backup before every firmware or routing change.

### Install on Raspberry Pi

1. Install a 64-bit Raspberry Pi OS Lite or Ubuntu Server image.
2. Install Git, Docker Engine, and Docker Compose v2 using the official [Docker Debian instructions](https://docs.docker.com/engine/install/debian/) or [Docker Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
3. Allow your user to run Docker, or prefix Docker commands with `sudo`.
4. Clone and start the panel:

```sh
git clone https://github.com/hattimon/SmartWAN-Manager.git
cd SmartWAN-Manager
cp .env.example .env
docker compose up -d --build
docker compose exec smartwan-manager node server/setPanelPassword.js admin 'replace-with-a-strong-password'
```

Open `http://<raspberry-pi-address>:8888`.

To choose the first free port beginning at `8888`:

```sh
sh scripts/start-smartwan-manager.sh
```

### Install on Ubuntu Server or a Linux PC

```sh
sudo apt update
sudo apt install -y git
git clone https://github.com/hattimon/SmartWAN-Manager.git
cd SmartWAN-Manager
cp .env.example .env
docker compose up -d --build
docker compose exec smartwan-manager node server/setPanelPassword.js admin 'replace-with-a-strong-password'
```

Install Docker first from the official [Ubuntu guide](https://docs.docker.com/engine/install/ubuntu/). Open `http://<server-address>:8888` and allow that port only on the trusted LAN if a host firewall is enabled.

### Install in WSL 2

1. Install WSL 2 with Ubuntu and enable Docker Desktop WSL integration.
2. Clone into the Linux filesystem (for example under `~/`, not `/mnt/c/`) and run:

```sh
git clone https://github.com/hattimon/SmartWAN-Manager.git
cd SmartWAN-Manager
cp .env.example .env
docker compose up -d --build
docker compose exec smartwan-manager node server/setPanelPassword.js admin 'replace-with-a-strong-password'
```

Open `http://localhost:8888` from Windows. The container must be able to reach the router's LAN address and SSH port. If Docker Desktop/WSL routing prevents that, use native Ubuntu, a small Linux VM in bridged mode, or a Raspberry Pi on the same LAN.

### Optional Tailscale container networking

The base Compose file starts without elevated network capabilities and is the most portable choice. On a Linux host with `/dev/net/tun`, start with the Tailscale overlay:

```sh
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d --build
```

Then configure and authorize Tailscale in the VPN tab. Do not use the overlay on a host that does not expose `/dev/net/tun` to Docker.

### First router setup

1. Enable SSH and JFFS custom scripts/configs in the ASUS interface.
2. Open **Configuration**, enter the router address, SSH port, username, and authentication method, then test SSH.
3. Prefer **SSH key** → generate an Ed25519 key in the panel or with [SSH Key Forge](https://github.com/hattimon/ssh-key-forge) → verify the router host fingerprint → paste the public key into ASUS **Administration → System → Authorized keys**.
4. Open **Scripts** and select **Install / update router scripts**.
5. Use the guided setup wizard or configure SmartWAN manually.
6. Preview conflicts and changes, apply, and verify both WAN cards, watchdog status, and important routes.

The installer uploads:

- `/jffs/addons/smartwan.d/backend.sh`;
- `/jffs/addons/smartwan.d/smartwanctl.sh`;
- `/jffs/addons/smartwan.d/smartwan.conf` when no configuration exists;
- managed blocks in `services-start`, `firewall-start`, `nat-start`, and `wan-event` Merlin hooks.

Existing hook content outside `# SMARTWAN MANAGED BEGIN` / `# SMARTWAN MANAGED END` is preserved.

### Storage model

On the router:

- SmartWAN configuration and presets;
- helper scripts and Merlin hook blocks;
- active route/firewall state;
- bounded runtime logs and WAN transition journal under `/tmp` (RAM).

In the Docker volume `smartwan-data`:

- panel login and session material;
- router connection settings and optional credentials;
- generated SSH private key;
- backups, UI preferences, service-routing groups, optional provider keys/tokens, prepared VPN profiles, Aurelka notes, and persistent WAN history.

Back up the volume and protect it as a credential store.

### Operations

For optional graphical management of this container and other Docker hosts—locally or remotely—see [hattimon/DCC](https://github.com/hattimon/DCC).

```sh
# status
docker compose ps

# logs
docker compose logs -f smartwan-manager

# update
git pull --ff-only
docker compose up -d --build

# stop without deleting data
docker compose down

# start again
docker compose up -d
```

Do not use `docker compose down -v` unless the panel data volume is intentionally being deleted.

### Development and verification

```sh
npm ci
npm test
npm run lint
npm run build
docker compose config
```

Run the development UI and API separately:

```sh
npm run dev
npm run server
```

The Vite server proxies `/api` to `http://127.0.0.1:8080`.

---

## Polski

### Do czego służy panel

SmartWAN Manager pozostawia router ASUS jako właściwy silnik routingu i dodaje wygodną, czytelną warstwę administracyjną:

- panel administracyjny ze stanem routera, firmware, uptime, RAM, JFFS, SSH, demona SmartWAN, obu WAN-ów, logów i tras;
- mapa sieci z aktywnymi klientami LAN, trasą bieżącego urządzenia, stanem VPN i historią zdarzeń WAN;
- kreator konfiguracji z wykrywaniem modelu/firmware, podglądem zmian, automatycznym backupem i potwierdzeniem zastosowania;
- konfiguracja SmartWAN i presety zapisane na routerze;
- konfiguracja natywnego ASUS Dual WAN, trybu load balance/failover, proporcji i reguł routingu;
- routing według urządzenia, podsieci, docelowego CIDR oraz domeny/usługi;
- grupy reguł usług, import/eksport JSON, walidacja i opcjonalne generowanie reguł z pomocą AI;
- opcjonalny monitoring kraju/lokalizacji WAN dla usług Google z automatyczną regułą tymczasową;
- routerowy watchdog, potwierdzanie awarii, failover, potwierdzanie odzyskania i powrót do normalnego routingu;
- zarządzane DMZ zależne od WAN-u z symetryczną trasą powrotną;
- polityka OpenVPN Server 1 i 2, edytor i pobieranie profili, dostęp LAN/router/Internet, NAT i preferowany WAN z failover;
- opcjonalny Tailscale subnet router/exit node oraz Cloudflare DDNS;
- generowanie klucza Ed25519 (w panelu lub przez [hattimon/ssh-key-forge](https://github.com/hattimon/ssh-key-forge)), kontrola klucza hosta, logowanie SSH hasłem/kluczem i instalacja skryptów Merlin;
- backup pełny lub tylko SmartWAN, podgląd i bezpieczne przywracanie;
- trwała historia awarii/odzyskania, testy jakości WAN, diagnostyka tras i ostrzeżenia o konfliktach;
- tryby interfejsu Bezpieczny, Podstawowy, Zaawansowany i Ekspert;
- interfejs polski i angielski.

Domyślne ustawienia watchdog SmartWAN:

| Ustawienie | Domyślnie |
|---|---:|
| Interwał testu | 1 sekunda |
| Błędy do przełączenia | 2 |
| Udane testy do powrotu | 3 |

To szybki profil przełączania. Dla niestabilnych łączy warto zwiększyć interwał lub liczniki, aby ograniczyć zbędne przełączenia.

### Co działa po wyłączeniu panelu

Większość zastosowanych ustawień znajduje się na routerze. Reguły i presety SmartWAN, routerowy watchdog i failover, zarządzana polityka VPN/DMZ oraz hooki Merlin działają dalej po zatrzymaniu kontenera.

Kontener musi pozostać uruchomiony dla funkcji wykonywanych przez panel: cyklicznego sprawdzania kraju/lokalizacji WAN, Cloudflare DDNS, dostępu Tailscale, kopiowania zdarzeń z bufora RAM routera do trwałej historii, publicznego statusu/mapy sieci oraz powiadomień Aurelki. Brak tych usług nie zatrzymuje routingu wykonywanego przez router.

### Panel logowania

Panel nie ma fabrycznego hasła. Po pierwszym uruchomieniu ustaw je na urządzeniu z Dockerem:

```sh
docker compose exec smartwan-manager node server/setPanelPassword.js admin 'wstaw-tu-mocne-haslo'
```

Ekran logowania zawiera:

- logowanie nazwą użytkownika i hasłem;
- podpisaną sesję `HttpOnly`, `SameSite=Lax` ważną maksymalnie 12 godzin;
- instrukcję resetu hasła wykonywanego lokalnie albo przez SSH na hoście panelu;
- wybór języka polskiego/angielskiego;
- sterowanie dźwiękiem i animacją Aurelki;
- rozwijany, tylko do odczytu stan połączenia;
- podgląd mapy sieci i obszar pobierania VPN dla klientów z dozwolonych podsieci LAN/VPN.

Panel powinien być dostępny tylko w zaufanej sieci. Przy reverse proxy ustaw `SMARTWAN_TRUSTED_PROXIES` możliwie wąsko i dopilnuj, aby proxy zastępowało niezaufane nagłówki przekazywania adresu klienta.

### Aurelka — strażniczka obu WAN-ów

Lewe i prawe oko Aurelki odpowiadają niezależnie za `wan0` i `wan1`:

| Oczy | Znaczenie | Zachowanie i powiadomienia |
|---|---|---|
| Zielone | Dany WAN jest sprawny | Aurelka jest spokojna, a dymek informuje, że łącza działają. |
| Pomarańczowe | Panel odczytuje stan, dane są nieaktualne/brakujące albo odzyskane łącze czeka na potwierdzenie powrotu | Oczy pulsują podczas sprawdzania; żarówka przyjmuje pomarańczowy stan ostrzegawczy. |
| Jedno czerwone, drugie zielone | Jeden WAN nie działa, a drugi jest dostępny | Aurelka wskazuje nazwę uszkodzonego WAN-u, miauczy dwa razy, a następnie co 30 sekund przypomina o trwającej awarii. |
| Oba czerwone | Oba WAN-y nie działają | Czerwony alarm, zła animacja, czerwona żarówka i powtarzane powiadomienie dźwiękowe, jeśli dźwięk jest włączony. |

Żarówka pulsuje po zmianie stanu WAN albo pojawieniu się nowej lokalnej wiadomości. Przeglądarka może odblokować dźwięk dopiero po pierwszej interakcji użytkownika. Aurelka pokazuje stan i pięć najnowszych wiadomości, daje się przeciągać, wraca na trasę po podwójnym kliknięciu, może zostać wyciszona lub zatrzymana. Wiadomości są zapisywane w woluminie Dockera, mają ograniczenie częstotliwości i są udostępniane tylko przez endpointy dla zaufanej sieci.

### Sugerowane wymagania

| Element | Praktyczne minimum | Zalecane |
|---|---|---|
| Raspberry Pi | Pi 3B+, system 64-bit, 1 GB RAM i swap | Pi 4/5, co najmniej 2 GB RAM, Raspberry Pi OS Lite 64-bit lub Ubuntu Server 64-bit |
| PC / mini PC / VM | 1 rdzeń x86-64/ARM64, 1 GB RAM | 2 wątki CPU, 2 GB RAM |
| Dysk | 1 GB wolnego | co najmniej 2 GB na obrazy, build, backupy i historię |
| Sieć | stabilny LAN i dostęp SSH do routera | Ethernet i stały/zarezerwowany adres hosta panelu |
| Oprogramowanie | Linux, Docker Engine, Compose v2, Git | aktualny 64-bitowy Linux i bieżący Docker/Compose |

Router wymaga firmware `386.3_3` z [gzenux/asuswrt-rtn18u](https://github.com/gzenux/asuswrt-rtn18u), włączonego SSH i skryptów/configów JFFS. Host panelu musi osiągać port SSH routera. Domyślnie panel używa lokalnego portu `8888/TCP`.

### Najpierw przygotuj firmware routera

SmartWAN Manager jest rozszerzeniem nieoficjalnego firmware Asuswrt-Merlin dla RT-N18U, a nie instalatorem firmware. Obsługiwana wersja musi już działać na routerze, zanim panel połączy się przez SSH i wdroży konfigurację SmartWAN.

Zachowaj następującą kolejność:

1. Przeczytaj pełną [instrukcję instalacji firmware RT-N18U](https://github.com/hattimon/asuswrt-rtn18u/tree/master) i wykonaj kopię bieżącej konfiguracji routera.
2. Jeżeli router nadal działa na oficjalnym AsusWRT, najpierw zaktualizuj oficjalny firmware do wersji `3.0.0.4.382.52288`. Jest to wersja przygotowawcza wskazana przez projekt firmware.
3. Przez interfejs WWW routera wgraj nieoficjalny Asuswrt-Merlin RT-N18U `386.3_3`. Instalacja firmware jest wykonywana niezależnie od SmartWAN Managera i na odpowiedzialność właściciela routera.
4. Po przejściu z oficjalnego AsusWRT przywróć ustawienia fabryczne sprzętowym przyciskiem reset. Skonfiguruj router od nowa; nie przywracaj pliku ustawień utworzonego w innej wersji firmware.
5. Włącz SSH oraz **niestandardowe skrypty i konfiguracje JFFS**. Dopiero wtedy zainstaluj SmartWAN Manager, sprawdź połączenie SSH i użyj kreatora albo sekcji **Skrypty**.

Na ostatnim etapie SmartWAN Manager przez SSH zapisuje na JFFS zarządzane skrypty, konfigurację, presety i bloki hooków Merlin, a następnie stosuje wybrane ustawienia routingu. Panel nie zastępuje obrazu firmware, bootloadera ani procedury aktualizacji firmware. Przed każdą zmianą firmware lub routingu zachowaj aktualną kopię bezpieczeństwa.

### Instalacja na Raspberry Pi

Zainstaluj system 64-bit oraz Git, Docker Engine i Compose v2 według oficjalnej instrukcji dla [Debiana](https://docs.docker.com/engine/install/debian/) albo [Ubuntu](https://docs.docker.com/engine/install/ubuntu/), a następnie:

```sh
git clone https://github.com/hattimon/SmartWAN-Manager.git
cd SmartWAN-Manager
cp .env.example .env
docker compose up -d --build
docker compose exec smartwan-manager node server/setPanelPassword.js admin 'wstaw-tu-mocne-haslo'
```

Otwórz `http://<adres-raspberry-pi>:8888`. Skrypt `sh scripts/start-smartwan-manager.sh` może automatycznie wybrać pierwszy wolny port od `8888`.

### Instalacja na Ubuntu Server / PC

```sh
sudo apt update
sudo apt install -y git
git clone https://github.com/hattimon/SmartWAN-Manager.git
cd SmartWAN-Manager
cp .env.example .env
docker compose up -d --build
docker compose exec smartwan-manager node server/setPanelPassword.js admin 'wstaw-tu-mocne-haslo'
```

Docker zainstaluj wcześniej według oficjalnej [instrukcji Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Otwórz `http://<adres-serwera>:8888`; zapora powinna dopuszczać ten port tylko z zaufanego LAN-u.

### Instalacja w WSL 2

Włącz WSL 2 z Ubuntu oraz integrację WSL w Docker Desktop. Sklonuj repozytorium do linuksowego katalogu, np. `~/SmartWAN-Manager`, i wykonaj te same komendy `docker compose`. Panel będzie dostępny pod `http://localhost:8888`. Kontener musi mieć trasę do adresu LAN i portu SSH routera. Jeśli sieć Docker Desktop/WSL to uniemożliwia, użyj natywnego Ubuntu, małej maszyny wirtualnej z mostkowaną siecią albo Raspberry Pi w tym samym LAN-ie.

### Opcjonalny Tailscale

Podstawowy Compose nie wymaga podwyższonych uprawnień sieciowych. Na Linuksie z `/dev/net/tun` uruchom wariant Tailscale:

```sh
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d --build
```

Następnie skonfiguruj i autoryzuj urządzenie w zakładce VPN. Nie używaj nakładki na hoście, który nie udostępnia `/dev/net/tun` do Dockera.

### Pierwsza konfiguracja routera

1. Włącz SSH oraz niestandardowe skrypty/configi JFFS w ASUS.
2. W **Konfiguracji** wpisz adres, port, użytkownika i metodę uwierzytelnienia, po czym przetestuj SSH.
3. Najlepiej wygeneruj klucz Ed25519 w panelu albo przez [SSH Key Forge](https://github.com/hattimon/ssh-key-forge), sprawdź fingerprint hosta i wklej klucz publiczny do **Administration → System → Authorized keys**.
4. W **Skryptach** wybierz instalację/aktualizację skryptów routera.
5. Użyj kreatora albo ręcznej konfiguracji SmartWAN.
6. Sprawdź konflikty i podgląd zmian, zastosuj ustawienia, a następnie zweryfikuj oba WAN-y, watchdog i ważne trasy.

Instalator zachowuje treść hooków poza blokami `# SMARTWAN MANAGED BEGIN` / `# SMARTWAN MANAGED END`.

### Dane i utrzymanie

Router przechowuje konfigurację, presety, skrypty, hooki i aktywny stan routingu. Logi wykonawcze i ograniczony bufor zdarzeń znajdują się w `/tmp`, czyli w RAM-ie routera.

Wolumin `smartwan-data` przechowuje logowanie panelu, ustawienia połączenia, opcjonalne dane uwierzytelniające, prywatny klucz SSH, backupy, preferencje, grupy reguł, opcjonalne klucze/tokeny usług, profile VPN, notatki Aurelki i trwałą historię WAN. Traktuj go jak magazyn poświadczeń i wykonuj jego backup.

Do opcjonalnego graficznego zarządzania tym kontenerem oraz innymi hostami Docker — lokalnie i zdalnie — możesz użyć [hattimon/DCC](https://github.com/hattimon/DCC).

```sh
# stan
docker compose ps

# logi
docker compose logs -f smartwan-manager

# aktualizacja
git pull --ff-only
docker compose up -d --build

# zatrzymanie bez kasowania danych
docker compose down
```

Nie używaj `docker compose down -v`, chyba że świadomie chcesz usunąć wolumin z danymi panelu.
