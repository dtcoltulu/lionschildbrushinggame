/** Tüm çocuğa dönük metinler burada. Kısa, net, Türkçe. (İleride çok dilli olabilir.) */
export const tr = {
  landing: {
    title: "Diş Kahramanı Ol!",
    ready: "Hazır mısın?",
    lead: "Fırçanı kap ve başlayalım!",
    start: "Başla",
    disclaimer: "Bu içerik ağız ve diş sağlığı farkındalığı amacıyla hazırlanmıştır.",
    privacy: "Gizlilik",
    noData: "İsim, telefon ya da kayıt yok.",
  },
  tutorial: {
    title: "Nasıl oynanır?",
    hint: "Fırçayı dişin üzerinde ileri geri hareket ettir.",
    done: "Süper! Şimdi gerçek oyun!",
    skip: "Atla",
    go: "Oyuna geç",
  },
  phases: [
    { name: "Dış yüzeyler", intro: "Dış yüzeyleri unutma!", done: "Dış taraf pırıl pırıl!" },
    { name: "İç yüzeyler", intro: "Şimdi iç taraf!", done: "İç taraf da tamam!" },
    { name: "Çiğneme yüzeyleri", intro: "Çiğneme yüzeylerini temizle!", done: "Çiğneme yüzeyleri temiz!" },
    { name: "Diş eti kenarı", intro: "Diş etlerinin kenarını nazikçe fırçala.", done: "Harika, nazik fırçalama!" },
  ],
  encouragement: ["Çok iyi!", "Harika gidiyorsun!", "Aferin!", "Süpersin!"],
  help: "Yardım",
  helpLabel: "Bir lekeyi temizle",
  progressLabel: "İlerleme",
  soundOn: "Sesi kapat",
  soundOff: "Sesi aç",
  canvasLabel: "Diş fırçalama oyunu. Parmağını ekranda ileri geri hareket ettirerek dişlerdeki lekeleri temizle.",
  reward: {
    trophyLabel: "Kupa",
    title: "TEBRİKLER!",
    subtitle: "DİŞ KAHRAMANI OLDUN!",
    learned: "Harika! Dişlerini nasıl koruyacağını öğrendin.",
    showStaff: "Bu ekranı Lions standındaki görevliye göster.",
    tips: [
      { icon: "🪥", text: "Günde 2 kez fırçala" },
      { icon: "⏱️", text: "Yaklaşık 2 dakika fırçala" },
      { icon: "😁", text: "Dişlerini düzenli kontrol ettir" },
    ],
    replay: "Tekrar Oyna",
  },
  privacyPage: {
    title: "Gizlilik",
    back: "Oyuna dön",
    body: [
      "Bu oyunda isim, soyisim, doğum tarihi, telefon, e-posta, fotoğraf, konum ya da sosyal medya hesabı istenmez ve toplanmaz. Giriş yapmak ya da profil oluşturmak gerekmez.",
      "Etkinliğin ne kadar ilgi gördüğünü ölçmek için yalnızca anonim sayımlar tutulur: sayfanın açılması, oyunun başlaması ve bitmesi, oyun süresi gibi. Bunlar, tarayıcıda rastgele üretilen bir kodla ilişkilendirilir; bu kod kimseyi tanımlamaz ve başka sitelerde kullanılmaz.",
      "Reklam yoktur. Üçüncü taraf takip aracı (tracker) kullanılmaz. IP adresi, cihaz parmak izi ya da tarayıcı bilgisi veritabanına kaydedilmez. Yalnızca cihazın telefon, tablet ya da bilgisayar olduğu gibi çok kaba bir sınıf bilgisi tutulabilir.",
      "Bu bilgiyi tarayıcının yerel depolama alanı saklar (çerez değildir). Tarayıcı verilerini silerek istediğin zaman temizleyebilirsin.",
      "Not: Sayfayı sunan barındırma hizmeti, teknik işleyiş gereği bağlantı kayıtlarını kısa süre için tutabilir; bu kayıtlar oyun verisiyle eşleştirilmez.",
    ],
  },
} as const;

export type PhaseCopy = (typeof tr.phases)[number];
