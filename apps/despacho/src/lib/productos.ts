export interface Producto {
  id: string;
  nombre: string;
  codigo: string | null;
  presentacion: string | null;
  activo: boolean;
}

/** Texto de la opción de un producto en una lista: «Harina Integral · HI-01 · Bolsas de 50 kg». */
export function etiquetaProducto(p: Pick<Producto, 'nombre' | 'codigo' | 'presentacion'>): string {
  return [p.nombre, p.codigo, p.presentacion].filter(Boolean).join(' · ');
}
