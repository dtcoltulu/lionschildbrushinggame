---
name: ios-builder
description: MobAI-App/ios-builder (`builder` CLI) ile Mac olmadan iOS uygulaması derleme, simülatörde deneme, imzalama, cihaza kurma, TestFlight ve App Store'a gönderme. Kullanıcı "iOS build", "IPA", "iPhone'a yükle", "TestFlight", "App Store'a gönder", "imzalama / sertifika / provisioning profile", "builder ios build", "builder init" ya da "ios-builder" dediğinde kullan.
---

# ios-builder (`builder` CLI)

`builder`, iOS derlemesini GitHub Actions (varsayılan), Codemagic veya Bitrise
üzerindeki macOS makinelerinde yaptırır; IPA'yı `./dist/` klasörüne indirir.
Kaynak: https://github.com/MobAI-App/ios-builder

## Bu repo hakkında önce bil

Bu repo (`lionschildbrushinggame`) bir **Next.js web uygulaması**; içinde Xcode
projesi yok. `builder` yalnızca şu projeleri tanır: Native iOS/Swift (`.`),
React Native (`ios/`), Expo (`ios/`, managed dahil), Flutter (`ios/`),
Kotlin Multiplatform (`iosApp/`), Cordova/Ionic (`platforms/ios/`).
Bir iOS kabuğu (ör. Expo, Cordova/Ionic veya `ios/` altında bir Xcode
projesi) eklenmeden `builder init` çalışmaz. Kabuk eklemek mimari bir karar:
önce kullanıcıya sor, kendiliğinden ekleme.

## Kurulum

Önce `command -v builder` ile kontrol et. Yoksa:

```bash
# macOS/Linux/WSL (/usr/local/bin'e yazar)
curl -sSL https://raw.githubusercontent.com/MobAI-App/ios-builder/main/install.sh | bash
# ya da Go varsa (bulut oturumlarında en kolayı)
go install github.com/MobAI-App/ios-builder/cmd/builder@latest   # ~/go/bin/builder
# macOS/Linux Homebrew
brew install mobai-app/tap/ios-builder
```

Windows: Releases'tan `builder-windows-amd64.exe` indirip `builder.exe` yap,
PATH'e ekle. Güncelleme: `builder update`.

## Kimlik doğrulama

- `builder auth github` — GitHub OAuth device flow. Ekranda bir kod ve
  https://github.com/login/device adresi çıkar; **kullanıcının** tarayıcıda
  onaylaması gerekir. Kodu kullanıcıya göster ve bekle. Linux/WSL'de token
  `~/.config/ios-builder/token` dosyasına yazılır (macOS/Windows'ta keychain).
- `builder auth codemagic` / `builder auth bitrise` — diğer sağlayıcılar.
  Etkileşimsiz ortamda `CODEMAGIC_API_TOKEN` / `BITRISE_API_TOKEN` okunur.
- `builder auth apple --issuer-id <id> --key-id <id> --key <AuthKey_X.p8>` —
  App Store Connect API anahtarı (imzalama, upload, submit, release için).
  Keychain yoksa (CI, ajan) bunun yerine `ASC_ISSUER_ID`, `ASC_KEY_ID` ve
  `ASC_KEY_PATH` (veya `ASC_PRIVATE_KEY`) ortam değişkenlerini kullan.
- `builder auth status` — hangi sağlayıcılara girildiğini gösterir.

## Temel akış

```bash
builder init                      # repo'yu tanır, workflow + builder.json yazar
builder ios build                 # derler, IPA'yı ./dist/ içine indirir
builder ios build --profile <ad>  # builder.json'daki bir profille
builder ios build --unsigned      # imzasız
builder ios share                 # simülatörde dene (MobAI uygulamasında, MOBAI_API_KEY secret'ı gerekir)
```

- `init` bayrakları: `--ios-path`, `--scheme`, `--provider github|codemagic|bitrise`,
  `--app-id` (Codemagic/Bitrise), `--branch`, `--set-default`. `init`
  `.github/workflows/ios-build.yml` ve `builder.json` yazar; bunların commit
  edilip varsayılan dala push edilmesi gerekir.
- `ios build` **diskteki çalışma ağacını** derler (commit edilmemiş dosyalar
  dahil, `.gitignore`'dakiler hariç). Anlık görüntüyü `origin`'deki gizli bir
  ref'e push eder ve derleme bitince siler; dal oluşturmaz.
- GitHub API'ye erişilemiyorsa tag ile tetiklenir:
  `git tag ios-build/<ad> && git push origin ios-build/<ad>`
  (simülatör için `ios-share/<ad>`).
- Varsayılan konfigürasyon `Debug`'dır. Bağımsız bir IPA için (ör. Expo'da JS
  bundle'ı gömülü) `builder.json` içinde `"ios": { "configuration": "Release" }`
  ya da `development` dışında bir `distribution` profili kullan.
- Expo managed: `app.json` içinde `expo.ios.bundleIdentifier` zorunlu; runner
  `expo prebuild` çalıştırır.

## builder.json profilleri

```json
{
  "ios": { "path": "ios", "bundleId": "com.example.app" },
  "defaultProfile": "development",
  "profiles": {
    "development": { "distribution": "development" },
    "preview":     { "distribution": "internal", "env": { "API_URL": "https://staging.example.com" } },
    "store":       { "distribution": "store" }
  }
}
```

`distribution`: `development`, `ad-hoc` (= `internal`), `store`, `enterprise`;
yoksa imzasız. Profil alanları: `configuration`, `scheme`, `provider`, `env`.
`env` değerleri **gizli değildir** (workflow girdisi olarak loglarda görünür);
token/şifreleri sağlayıcı secret'larına koy (`gh secret set` vb.).

## İmzalama (ücretli Apple Developer hesabı gerekir)

```bash
builder signing setup --devices-from-mobai       # development seti: sertifika + cihazlar + profil
builder signing setup --distribution store       # App Store seti
builder signing setup --certificate x.p12 --profile y.mobileprovision  # kendi dosyalarınla
```

Sertifikaları API ile oluşturur ve GitHub secret'larına yükler
(`IOS_CERTIFICATE_<SET>`, `IOS_CERTIFICATE_PASSWORD_<SET>`,
`IOS_PROVISIONING_PROFILE_<SET>`). Ücretli hesap yoksa imzasız derle; MobAI
kurulumda ücretsiz Apple ID ile yeniden imzalayabilir.

## Dağıtım

```bash
builder ios build --profile development --distribute   # kablosuz kurulum linki + QR
builder ios distribute [--ipa x.ipa] [--once] [--json]
builder ios release --profile store --group "Beta Testers" --notes "Ne test edilecek" --json
builder ios release --profile store --app-store --release after-approval --json
builder ios upload --wait --json
builder ios submit --testflight --group "Beta Testers" --notes "..." --json
builder asc apps|builds|groups|testers|users --json
```

`release`, `upload`, `submit`, `distribute` ve `asc` komutları `--json` ile
makine okunur çıktı verir ve hiç soru sormaz; ajan olarak bunları `--json`
ile çalıştır.

## Cihazda geliştirme (MobAI gerekir)

`builder dev rn`, `builder dev flutter`, `builder dev kmp`;
kurulu uygulama için `--skip-install --bundle-id <id>`.
Bağlantı testi: `builder mobai ping`.

## Kurallar

- Şunlardan **önce kullanıcıdan onay al**; dışarıya etki eden, geri alınması
  zor işlemlerdir: `builder init` sonrası workflow'u push etmek,
  `ios build`/`ios share` (origin'e push eder ve CI dakikası harcar),
  `signing setup` (Apple hesabında sertifika/App ID/cihaz oluşturur,
  GitHub secret'larını değiştirir), `ios release`/`upload`/`submit`
  (özellikle `--app-store`: incelemeye gönderir), `asc ... delete|expire|invite`.
- `.p8`, `.p12`, `.mobileprovision` ve `ios-signing-*.key` dosyalarını asla
  commit etme ve sohbete yazdırma; gerekiyorsa `.gitignore`'a ekle.
- `ios build` çalışma ağacını yüklediği için gizli dosyaların gitignore'da
  olduğundan emin ol.
- Hata olursa `-v` (verbose) ile tekrar çalıştır; ayrıntılar için
  `builder <komut> --help` veya repo README'si.
