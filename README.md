# Rebuild e Redistribuzione Frontend

Queste istruzioni generano il build statico di React e lo pubblicano sul Raspberry in:
`/home/roberto/crocerosacelestefestivi/frontend` (servito da Nginx).

## 1) Build locale (Mac)

Assicurati che le API siano chiamate in same-origin tramite Nginx (evita CORS): usa la base relativa `/api/festivi/assegna`.

```bash
cd "/Users/rbruni/Library/CloudStorage/OneDrive-LuxotticaGroupS.p.A/work/IdeaProjects/CroceRosacelesteFestiviNewFrontend"
npm ci
REACT_APP_API_BASE_URL="/api/festivi/assegna" npm run build
# impacchetta il build
tar -C build -czf build.tgz .
```

## 2) Copia sul Raspberry

Sostituisci l'IP se diverso. Se usi una porta SSH non standard, aggiungi `-P 2222`.

```bash
scp build.tgz roberto@192.168.1.50:/home/roberto/crocerosacelestefestivi/
```

## 3) Deploy sul Raspberry

```bash
ssh roberto@192.168.1.50 "rm -rf /home/roberto/crocerosacelestefestivi/frontend/* && \
  tar xzf /home/roberto/crocerosacelestefestivi/build.tgz -C /home/roberto/crocerosacelestefestivi/frontend && \
  rm /home/roberto/crocerosacelestefestivi/build.tgz && \
  sudo systemctl reload nginx"
```

## 4) Verifica

```bash
# Deve stampare il nome del main.*.js del nuovo build
curl -s http://192.168.1.50/index.html | grep -o 'main\.[^.]*\.js' | head -1
```
Apri in browser: `http://192.168.1.50`

## 5) Note e Troubleshooting

- CORS: il build deve usare `REACT_APP_API_BASE_URL="/api/festivi/assegna"` (relative). Nginx proxa `/api` verso il backend su `127.0.0.1:8080`.
- 403 Forbidden: verifica permessi/owner della cartella frontend (leggibile da Nginx) e che esista `index.html`.
- Reload Nginx:
```bash
sudo nginx -t && sudo systemctl reload nginx
```
- Aggiornare solo il testo del pulsante upload: nessun rebuild speciale; basta rebuild standard.
