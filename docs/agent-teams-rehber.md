# Agent Teams (Ajan Takımları) — Türkçe Referans

> Claude Code v2.1.32+ gerektirir. `claude --version` ile kontrol edin.

Agent teams **deneyseldir** ve varsayılan olarak kapalıdır. Etkinleştirmek için `.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

---

## Nedir?

Birden fazla Claude Code oturumunun birlikte çalıştığı bir koordinasyon sistemi. Bir oturum **takım lideri** olarak görev yapar; diğerleri (**teammates**) bağımsız bağlamlarda çalışır ve birbirleriyle doğrudan mesajlaşabilir.

Subagent'lardan farkı: Subagent'lar yalnızca ana ajana rapor verir; teammate'ler birbirleriyle konuşabilir.

---

## Ne Zaman Kullanılır?

**Uygun senaryolar:**
- Paralel araştırma/inceleme (birden fazla açıdan aynı anda bakış)
- Bağımsız modüller veya özellikler (dosya çakışması olmadan)
- Rekabet eden hipotezlerle hata ayıklama
- Frontend / backend / test gibi katmanlar arası koordinasyon

**Uygun olmayan senaryolar:**
- Sıralı görevler
- Aynı dosyayı düzenleyen işler
- Bağımlılığı çok olan işler

Token maliyeti tek oturuma göre belirgin şekilde yüksektir.

---

## Subagent vs Agent Team

| | Subagent | Agent Team |
|---|---|---|
| **Bağlam** | Kendi context window'u; sonuç ana ajana döner | Tam bağımsız context window |
| **İletişim** | Yalnızca ana ajana rapor verir | Teammate'ler birbirine doğrudan mesaj atar |
| **Koordinasyon** | Ana ajan yönetir | Paylaşımlı görev listesiyle öz-koordinasyon |
| **En iyi kullanım** | Sonuç yeterli olan odaklı görevler | Tartışma ve işbirliği gerektiren karmaşık işler |
| **Token maliyeti** | Düşük | Yüksek |

---

## İlk Takımı Başlatmak

Etkinleştirdikten sonra Claude'a doğal dilde söyleyin:

```text
CLI aracı tasarlıyorum. Farklı açılardan incelemeleri için bir agent team oluştur:
biri UX, biri teknik mimari, biri şeytan avukatı rolünde.
```

Claude takımı kurar, teammate'leri oluşturur, çalıştırır ve bitince temizler.

Terminalde takım lideri ve tüm teammate'ler listelenir. **Shift+Down** ile teammate'ler arasında geçiş yapılır.

---

## Görüntüleme Modu

İki mod vardır:

| Mod | Açıklama |
|---|---|
| `in-process` | Tüm teammate'ler ana terminalde çalışır. Shift+Down ile geçiş yapılır. |
| `tmux` / iTerm2 | Her teammate ayrı pane'de açılır, hepsini aynı anda görmek mümkün. |

Varsayılan `"auto"`: zaten tmux içindeyseniz split pane, değilseniz in-process.

`~/.claude/settings.json` ile geçersiz kılmak için:

```json
{
  "teammateMode": "in-process"
}
```

Tek oturum için:

```bash
claude --teammate-mode in-process
```

Split pane için **tmux** ya da **iTerm2 + it2 CLI** gerekir. VS Code terminali, Windows Terminal ve Ghostty desteklenmez.

---

## Takımı Yönetmek

### Belirli teammate ve model belirtmek

```text
4 teammate ile bu modülleri paralel refactor etmeleri için takım kur.
Her teammate için Sonnet kullan.
```

### Plan onayı zorunlu kılmak

```text
Auth modülünü refactor etmek için bir mimar teammate oluştur.
Değişiklik yapmadan önce plan onayı iste.
```

Teammate plan hazırlar → lider inceler → onaylar veya geri bildirimle reddeder → onaylanınca uygulama başlar.

### Teammate'e doğrudan mesaj göndermek

- **In-process:** Shift+Down ile geçiş → mesaj yaz
- **Split pane:** İlgili pane'e tıkla

### Görev atama

Paylaşımlı görev listesi üzerinden çalışılır. Lider görevleri atar ya da teammate'ler kendileri sahiplenir. Bağımlı görevler, bağımlı oldukları görev tamamlanana kadar alınamaz.

### Teammate kapatmak

```text
Araştırmacı teammate'i kapat
```

Lider kapatma isteği gönderir; teammate onaylar veya reddeder.

### Takımı temizlemek

```text
Takımı temizle
```

Önce tüm teammate'ler kapatılmalı, sonra lider temizlik yapmalı. Teammate'lerin temizlik yapması bırakılan kaynaklara yol açabilir.

---

## Hook'larla Kalite Kapısı

| Hook | Ne zaman çalışır | Kullanım |
|---|---|---|
| `TeammateIdle` | Teammate boşa düşmek üzereyken | Exit 2 → geri bildirim gönder, çalışmaya devam et |
| `TaskCreated` | Görev oluşturulurken | Exit 2 → oluşturmayı engelle |
| `TaskCompleted` | Görev tamamlandı işaretlenirken | Exit 2 → tamamlamayı engelle |

---

## Mimari

| Bileşen | Rol |
|---|---|
| **Takım lideri** | Takımı kuran, teammate'leri oluşturan, koordine eden ana oturum |
| **Teammate'ler** | Bağımsız Claude Code örnekleri |
| **Görev listesi** | Tüm ajanların görebileceği paylaşımlı iş listesi |
| **Posta kutusu** | Ajanlar arası mesajlaşma sistemi |

Depolama yerleri:
- Takım konfigürasyonu: `~/.claude/teams/{team-name}/config.json`
- Görev listesi: `~/.claude/tasks/{team-name}/`

Bu dosyalar otomatik yönetilir — elle düzenlemeyin.

### İzinler

Teammate'ler liderin izin ayarlarıyla başlar. Lider `--dangerously-skip-permissions` ile çalışıyorsa tüm teammate'ler de aynı şekilde çalışır.

### Bağlam ve İletişim

- Her teammate kendi context window'unda başlar
- Liderin konuşma geçmişi aktarılmaz
- CLAUDE.md, MCP sunucuları ve skill'ler otomatik yüklenir
- Mesajlar otomatik teslim edilir, lider yoklama yapmaz
- Boşa düşen teammate lideri otomatik bilgilendirir

---

## Subagent Tanımlarını Teammate Olarak Kullanmak

Daha önce tanımlanmış bir subagent tipini teammate olarak çağırabilirsiniz:

```text
Auth modülünü denetlemesi için security-reviewer ajan tipini kullanan bir teammate oluştur.
```

- Subagent tanımındaki `tools` allowlist ve `model` dikkate alınır
- Takım koordinasyon araçları (`SendMessage`, görev yönetimi) her zaman aktiftir
- `skills` ve `mcpServers` frontmatter alanları teammate modunda uygulanmaz

---

## En İyi Pratikler

### Yeterli bağlam ver

```text
Spawn etme promptu: "src/auth/ içindeki kimlik doğrulama modülünü güvenlik açıkları için incele.
Token yönetimi, oturum yönetimi ve giriş doğrulamaya odaklan.
Uygulama httpOnly cookie'lerde JWT token kullanıyor. Bulguları önem derecesiyle raporla."
```

### Takım boyutunu seç

- Çoğu iş akışı için **3-5 teammate** ile başla
- Her teammate için **5-6 görev** uygun oran
- Maliyetler doğrusal büyür; gereksiz büyütme verimsizleştirir

### Görev boyutunu ayarla

- **Çok küçük:** Koordinasyon yükü faydayı aşar
- **Çok büyük:** Kontrol noktası olmadan uzun süre çalışır
- **İdeal:** Net bir çıktı üretecek bağımsız birimler (fonksiyon, test dosyası, inceleme)

### Teammate'lerin bitmesini bekle

```text
Devam etmeden önce teammate'lerinin görevlerini tamamlamasını bekle
```

### Dosya çakışmasından kaçın

Her teammate farklı dosya grubuna sahip olsun.

---

## Kullanım Örneği: Paralel Kod İncelemesi

```text
PR #142'yi incelemek için agent team oluştur. Üç inceleyici oluştur:
- Biri güvenlik etkilerine odaklansın
- Biri performans etkisini kontrol etsin
- Biri test kapsamını doğrulasın
Her biri incelesin ve bulgularını raporlasın.
```

## Kullanım Örneği: Rekabet Eden Hipotezlerle Hata Ayıklama

```text
Kullanıcılar uygulamanın bir mesajdan sonra bağlantıyı kestiğini bildiriyor.
5 teammate oluştur, her biri farklı hipotezi araştırsın.
Birbirlerinin teorilerini çürütmeye çalışsınlar — bilimsel tartışma gibi.
Ortaya çıkan uzlaşıyı bulgular dokümanına yaz.
```

---

## Sorun Giderme

| Sorun | Çözüm |
|---|---|
| Teammate'ler görünmüyor | Shift+Down ile döngü yap; görevin takım gerektirecek kadar karmaşık olduğunu kontrol et |
| Çok fazla izin istemi | Yaygın işlemleri spawn öncesi izin ayarlarında önceden onayla |
| Teammate hata sonrası duruyor | Shift+Down ile çıktısını gör, doğrudan talimat ver veya yeni teammate oluştur |
| Lider iş bitmeden kapanıyor | "Devam et" veya "Teammate'lerin bitmesini bekle" de |
| Artık tmux oturumu | `tmux ls` → `tmux kill-session -t <oturum-adı>` |

---

## Kısıtlamalar

- **In-process teammate'lerle oturum devam ettirme yok:** `/resume` ve `/rewind` in-process teammate'leri geri yüklemez
- **Görev durumu gecikebilir:** Tamamlanan görevler bazen işaretlenmeyebilir; takılırsa elle güncelle
- **Kapatma yavaş olabilir:** Mevcut istek bitmeden kapanmaz
- **Oturum başına bir takım:** Yeni takım kurmadan önce mevcut takımı temizle
- **İç içe takım yok:** Teammate'ler kendi takımlarını kuramaz
- **Lider değiştirilemez:** Takımı kuran oturum süresince liderdir
- **Split pane sadece tmux/iTerm2:** VS Code, Windows Terminal, Ghostty desteklenmez

---

## İlgili Konular

- **Subagents** — Koordinasyon gerektirmeyen hafif delegasyon
- **Git Worktrees** — Otomatik koordinasyon olmadan paralel oturumlar
