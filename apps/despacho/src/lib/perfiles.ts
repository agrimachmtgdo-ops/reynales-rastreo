/**
 * Perfiles del personal. «Logística» es el rol «despacho» de la base; «comercial» y «almacén»
 * son gerencia (solo lectura) + su área.
 */
export type Perfil = 'administrador' | 'logistica' | 'gerencia' | 'comercial' | 'almacen';

export const PERFILES: { id: Perfil; nombre: string; descripcion: string }[] = [
  { id: 'administrador', nombre: 'Administrador', descripcion: 'Todo, incluidos los usuarios.' },
  { id: 'logistica', nombre: 'Logística', descripcion: 'Misiones, camiones, choferes, transportistas y documentos.' },
  { id: 'comercial', nombre: 'Comercial', descripcion: 'Clientes (y pedidos, próximamente). Ve el resto sin editar.' },
  { id: 'almacen', nombre: 'Almacén', descripcion: 'Inspección del camión, lotes, balanza y cierre de carga con precinto. Ve el resto sin editar.' },
  { id: 'gerencia', nombre: 'Gerencia', descripcion: 'Ve todo y los reportes, sin editar.' },
];

export function nombrePerfil(perfil: string | null | undefined): string {
  return PERFILES.find((p) => p.id === perfil)?.nombre ?? 'sin perfil';
}

export function esPerfil(valor: unknown): valor is Perfil {
  return PERFILES.some((p) => p.id === valor);
}
