// La tarea de ubicación en segundo plano debe definirse ANTES de montar la app.
import './src/tareaUbicacion';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
