"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto max-w-lg p-6 text-center">
      <h1 className="text-xl font-bold">Sayfa yüklenemedi</h1>
      <p className="mt-2 text-muted">Bağlantı ya da sunucu kaynaklı geçici bir sorun olabilir. Formlarda girdiğiniz bilgiler bu cihazda saklanır.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted">Hata kodu: {error.digest}</p>}
      <button type="button" className="btn btn-primary mt-4" onClick={reset}>Tekrar dene</button>
    </div>
  );
}
