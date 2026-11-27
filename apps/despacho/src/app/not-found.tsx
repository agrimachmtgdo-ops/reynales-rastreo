import Link from 'next/link';

export default function NoEncontrado() {
  return (
    <main className="contenido">
      <div className="tarjeta">
        <h1>No encontrado</h1>
        <p>La página o la misión no existe. <Link href="/">Volver al tablero</Link></p>
      </div>
    </main>
  );
}
