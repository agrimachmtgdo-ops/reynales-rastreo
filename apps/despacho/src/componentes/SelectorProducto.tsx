import Link from 'next/link';
import { Req } from './Obligatorio';
import { etiquetaProducto, type Producto } from '@/lib/productos';

/**
 * Lista de productos del catálogo para pedidos y misiones (sin JavaScript en el cliente).
 * Si el registro tiene un producto inactivo o un texto antiguo fuera del catálogo, lo muestra para no perderlo.
 */
export default function SelectorProducto({
  productos, actualId, textoAnterior, obligatorio = false, nombre = 'producto_id',
}: {
  productos: Producto[];
  actualId?: string | null;
  textoAnterior?: string | null;
  obligatorio?: boolean;
  nombre?: string;
}) {
  const activos = productos.filter((p) => p.activo || p.id === actualId);
  const sinEnlace = !actualId && textoAnterior;
  return (
    <label>
      <span className="etiqueta-campo">Producto {obligatorio && <Req />}</span>
      <select name={nombre} required={obligatorio} defaultValue={actualId ?? ''}>
        <option value="" disabled={obligatorio}>{sinEnlace ? `«${textoAnterior}» (fuera del catálogo)` : 'Seleccione…'}</option>
        {activos.map((p) => <option key={p.id} value={p.id}>{etiquetaProducto(p)}{p.activo ? '' : ' (inactivo)'}</option>)}
      </select>
      <span className="ayuda-campo">
        {activos.length === 0
          ? <>Aún no hay productos. Créelos en <Link href="/catalogos?pestana=productos">Catálogos → Productos</Link>.</>
          : <>¿Falta uno? Agréguelo en <Link href="/catalogos?pestana=productos">Catálogos → Productos</Link>.</>}
      </span>
    </label>
  );
}
