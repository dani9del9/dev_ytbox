// YTBox — Contenido de la página de Ayuda del gestor.
// Mantener al día con cada cambio de la extensión.
// Formato: cada sección tiene id, título, icono (de svg-icons.js) y bloques:
//   'texto'               → párrafo (admite **negrita**)
//   ['ul', 'a', 'b', …]   → lista
//   ['tip', 'texto']      → nota destacada
const YTBOX_HELP = [
  {
    id: 'inicio', title: 'Qué es YTBox', icon: 'casa', blocks: [
      'YTBox organiza tus canales de YouTube en **grupos** (Juegos, Cocina, Música…) con el icono y el color que quieras, y te avisa de los vídeos nuevos de cada grupo. Además trae el **Modo TV** (listas aleatorias con la duración que elijas), **Descubrir** (canales parecidos a los tuyos), **Nuevos vídeos** (todo lo nuevo en una página) y un **Calendario** de subidas.',
      'Funciona en dos sitios:',
      ['ul',
        '**Dentro de YouTube**: una sección «YTBox» en la barra lateral, un botón en la barra superior y un botón junto a «Suscribirse» en cada canal y vídeo.',
        '**En el gestor** (esta página): para crear y editar grupos, Modo TV, Descubrir, Calendario, ajustes y esta ayuda. El icono de la extensión y el ⚙ de la sección YTBox del menú lateral lo abren en **Ajustes**; «Gestionar grupos» del menú ▾ lo abre en tus grupos, y «Editar» de un grupo, en ese grupo.'],
    ],
  },
  {
    id: 'grupos', title: 'Crear grupos y añadir canales', icon: 'carpeta', blocks: [
      ['ul',
        '**Nuevo grupo**: botón «+ Nuevo grupo» arriba a la izquierda del gestor (o el «+» de la sección YTBox en YouTube).',
        '**Icono y nombre**: pulsa el icono grande del grupo para elegir entre emojis e iconos y cambiar su color; el nombre se edita directamente.',
        '**Añadir canales al grupo**: escribe su @usuario o pega la dirección del canal, o elígelos de la lista «Añadir desde tus canales importados».',
        '**Desde YouTube**: en la página de un canal o de un vídeo, junto a «Suscribirse», está el botón de YTBox. Al pulsarlo eliges en qué grupos está ese canal (casillas). Si ya está en alguno, el botón lo indica.',
        '**Desde tus suscripciones**: en youtube.com/feed/channels cada canal tiene su botón de grupos, y abajo aparece «Importar todas mis suscripciones».',
        '**Ver en YouTube** abre el grupo en YouTube; **Borrar grupo** lo elimina (los canales siguen guardados).'],
      ['tip', 'Un mismo canal puede estar en varios grupos. Si un canal se guardó por su código interno (UC…) y otro por su @usuario, YTBox los reconoce como el mismo.'],
    ],
  },
  {
    id: 'lateral', title: 'En YouTube: barra lateral y botón superior', icon: 'lista', blocks: [
      ['ul',
        '**Sección YTBox** en la barra lateral de YouTube: pulsa «YTBox ▾» para plegarla o desplegarla.',
        'Arriba del todo: **Modo TV** (con «▸ N» para desplegar tus preconfiguraciones y lanzarlas con un clic), **Descubrir** y **Nuevos vídeos** (con el total de vídeos nuevos).',
        'Debajo, tus **grupos** con el número de **vídeos nuevos** de cada uno. Si no hay nuevos, no sale número. Con **Ajustes → Opciones de portada → Mostrar solo los grupos con vídeos nuevos** solo salen los que tienen novedades.',
        'Menú **⋮** de la cabecera YTBox: «Marcar todo como visto», **Buscar vídeos nuevos ahora** (vuelve a mirar ya todos tus canales; sin pulsarlo, YTBox lo comprueba solo al abrir YouTube y cada pocos minutos) y el orden de los grupos. En todos los órdenes, **los grupos con vídeos nuevos van arriba**. **Vídeos nuevos** (por defecto): primero los que tienen más nuevos y, el resto, por el último vídeo subido. También puedes ordenar por **nombre (A-Z, Z-A)** o por **grupos con más canales**. Los fijados siempre van los primeros.',
        'Con **Ajustes → Opciones de portada → Previsualizar nuevos en menú**, al pasar el ratón por un grupo con vídeos nuevos se despliega a su derecha un panel con esos vídeos y los botones **Abrir grupo** y **Marcar como visto** (quita sus novedades sin salir de la barra lateral); la **✕** de la cabecera del panel lo cierra.',
        'Menú **⋮ de cada grupo** (aparece al pasar el ratón por el grupo): **Marcar como leído** (quita sus novedades), **Fijar arriba** (el grupo queda siempre al principio de la lista, con una chincheta; «Quitar de arriba» lo devuelve a su sitio), **Silenciar** (el grupo sale en gris con una campana tachada y no muestra novedades ni cuenta en «Nuevos vídeos» hasta que pulses «Activar novedades») y **Editar** (abre ese grupo en el gestor).',
        '**Botón de YTBox en la barra superior** (junto a Crear y notificaciones): abre un desplegable con Modo TV, Descubrir, Nuevos vídeos, tus grupos y, al final, **Ajustes de YTBox**. Siempre a mano aunque la barra lateral esté cerrada. Su número es el total de vídeos nuevos (el mismo que «Nuevos vídeos») y baja al abrir grupos o ver vídeos, también en otras pestañas.'],
      ['tip', 'Los números se pintan al momento con los últimos datos guardados y se van poniendo al día mientras YTBox lee los canales. Si tienes el filtro «Vídeos» en los grupos, los Shorts no cuentan como nuevos.'],
    ],
  },
  {
    id: 'portada', title: 'Estante en la portada de YouTube', icon: 'casa', blocks: [
      'En la portada de YouTube, entre las recomendaciones (después de sus dos primeras filas), YTBox muestra un estante (con el rótulo **YTBox** delante del nombre del grupo) con **los 3 vídeos más recientes de uno de tus grupos**, elegido al azar cada vez que entras (nunca uno silenciado).',
      ['ul',
        'Pulsa el **nombre del grupo ▾** para elegir otro, o el botón **aleatorio** para otro al azar.',
        '**‹ ›** muestran los 3 vídeos anteriores o siguientes del grupo (arriba ves, por ejemplo, «4–6 de 45»).',
        '**▶ Reproducir todo** pone los vídeos del grupo en una lista; **Abrir grupo** abre la vista completa; el **⚙** lleva a los Ajustes.',
        'Cada vídeo muestra miniatura, duración, canal (pulsable), visualizaciones y antigüedad, con la etiqueta **Nuevo** o **VISTO**. Los Shorts no salen.',
        'Al pasar el ratón por un vídeo tienes **Ver más tarde**, **Guardar en una lista** y **Añadir a la cola**, y su menú **⋮** tiene las mismas opciones que en los grupos.',
        'La cabecera del estante va con los colores de la app y los textos en blanco.',
        'Se activa o desactiva en **Ajustes → Opciones de portada → Estante de YTBox en la portada de YouTube**.'],
    ],
  },
  {
    id: 'vista-grupo', title: 'La vista de un grupo', icon: 'cuadricula', blocks: [
      'Al pulsar un grupo se abre encima de YouTube con los últimos vídeos de todos sus canales.',
      ['ul',
        '**Cabecera**: nombre, número de nuevos (púlsalo para ver solo los nuevos), buscador dentro del grupo, **calendario**, recargar, editar el grupo y cerrar.',
        '**Fila de canales**: pulsa uno para ver solo sus vídeos; el número rojo son sus nuevos. Algunos llevan un aviso (ver «Avisos de canales»).',
        '**Filtros**: orden (más recientes, más antiguos, más vistos o por canal), fecha (últimas 24 horas, semana, mes o cualquiera), **Todo / Vídeos / Shorts** y **Todos / No vistos**.',
        '**Vistas**: cuadrícula, compacta o lista (botones de la derecha).',
        '**En cada vídeo**: etiqueta **Nuevo** si se subió desde tu última visita al grupo, **VISTO** si ya lo viste, y la **duración** abajo a la derecha (o SHORT). Pulsar el **nombre o el avatar del canal** te lleva a su canal en vez de reproducir el vídeo (con Ctrl o clic central, en otra pestaña).',
        'Al **pasar el ratón** por la miniatura: Ver más tarde, Guardar en una lista y Añadir a la cola de YouTube.',
        'Menú **⋮** de cada vídeo: añadir a la cola, Ver más tarde, guardar en una lista, **cambiar los grupos del canal** (casillas con todos tus grupos), marcar como nuevo / quitar marca, marcar como visto / no visto.'],
      'Al entrar en un grupo se apunta la visita: la próxima vez serán «Nuevo» los vídeos subidos después.',
    ],
  },
  {
    id: 'aplicar', title: 'Acciones con varios vídeos (Aplicar)', icon: 'cola', blocks: [
      'Arriba a la derecha de cada grupo hay dos desplegables y el botón **Aplicar**:',
      ['ul',
        '**Qué vídeos**: Todos, Nuevos, Aleatorio o **Seleccionar** (marca a mano los que quieras con las casillas). Cada opción indica cuántos vídeos son.',
        '**Qué hacer**: **Añadir a la cola** (crea una lista y empieza a verla, máximo 50), **Añadir a Ver más tarde**, **Añadir a una playlist** (eliges una tuya o creas una nueva), **Marcar como vistos** o **Marcar como nuevos** (cambia la marca de los vídeos elegidos al momento, sin necesitar sesión de YouTube).',
        '**Aplicar** hace la acción. Lo que elijas en el segundo desplegable se recuerda.'],
      ['tip', 'Ver más tarde y las playlists necesitan tener la sesión de YouTube iniciada.'],
    ],
  },
  {
    id: 'nuevos', title: 'Nuevos vídeos', icon: 'nuevos', blocks: [
      'Junta en una sola página **todos los vídeos nuevos de todos tus grupos** (un vídeo cuenta si es nuevo en alguno de los grupos de su canal y no lo has visto).',
      ['ul',
        'Cada tarjeta lleva **chips con el grupo** al que pertenece; púlsalos para abrir ese grupo.',
        'La fila de canales muestra solo los que tienen algo nuevo.',
        '**Entrar aquí no cambia las marcas de los grupos**: siguen con sus «Nuevo» y sus números.',
        'El botón **«Marcar todos como vistos en los grupos»**, debajo de la botonera y encima de los vídeos, sí quita la etiqueta Nuevo de todo, en todos tus grupos. Sale en gris cuando no hay vídeos nuevos.'],
    ],
  },
  {
    id: 'calendario', title: 'Calendario', icon: 'calendario', blocks: [
      'Muestra qué días han subido vídeos tus canales. Los días con vídeos se colorean más cuantos más hay, con el número y los avatares de los canales.',
      ['ul',
        '**En cada grupo** (botón de calendario de la cabecera): pulsa un día para ver solo los vídeos de ese día; vuelve a pulsarlo para quitar el filtro. Respeta el resto de filtros.',
        '**En el gestor** («Calendario» en el menú): junta **todos los vídeos de todos tus grupos**. Puedes filtrar por grupo y por Vídeos / Shorts / Todo, y al pulsar un día salen sus vídeos con su grupo. «⟳ Actualizar» vuelve a leerlos.',
        '‹ › cambian de mes y «Hoy» vuelve al actual.'],
      ['tip', 'YouTube solo da los últimos 15 vídeos de cada canal, así que los meses antiguos salen más vacíos.'],
    ],
  },
  {
    id: 'tv', title: 'Modo TV', icon: 'tv', blocks: [
      'Crea una lista **aleatoria** con vídeos de los canales que elijas y la reproduce en YouTube, con la duración total que indiques. Se abre desde la barra lateral, el desplegable de arriba o el menú del gestor.',
      ['ul',
        '**¿De qué canales?**: grupos enteros y/o canales sueltos. El primer chip, **Marcar todos / Desmarcar todos**, elige o quita todos los grupos de golpe. Los canales sueltos elegidos salen como **chips** con una × para quitarlos y un botón «Quitar todos».',
        '**¿Qué vídeos?**: solo los que no has visto, fecha de subida (último día, 3 días, semana, mes o cualquiera) y **duración máxima de cada vídeo**.',
        '**¿Cuánto tiempo?**: minutos u horas (con atajos de 30 min, 1 h, 2 h y 4 h).',
        '**¿Cómo lo ves?**: **Vídeos completos** o **Picoteo** (ver abajo).',
        'Nunca se añaden vídeos **solo para miembros** ni vídeos de menos de 1 minuto.'],
      ['tip', 'Con la sesión iniciada, la lista se crea en tu cuenta como lista privada llamada «YTBox TV mode» o, si la lanzas desde una preconfiguración, con el nombre de esa preconfiguración. Cada vez se sustituye la anterior del mismo nombre. Sin sesión se usa una lista temporal de YouTube.'],
    ],
  },
  {
    id: 'tv-presets', title: 'Modo TV: preconfiguraciones y previsualización', icon: 'estrella', blocks: [
      ['ul',
        '**Guardar**: configura el Modo TV, escribe un nombre (p. ej. «Dormir») y pulsa 💾 Guardar. Si el nombre ya existe, se actualiza.',
        '**Usar**: en «Mis preconfiguraciones» cada una es un chip pequeño; pasa el ratón por encima para ver su resumen (duración, fechas, grupos…). Pulsa el nombre para cargarla, el ▶ pequeño para verla directamente o ✕ (dos veces) para borrarla. También salen bajo «Modo TV» en la barra lateral y en el desplegable de arriba (botón «▸ N»): al pulsarlas se abre el Modo TV con esa preconfiguración y la lista **ya preparada en la previsualización**; no empieza a reproducirse hasta que pulses **VER ESTA LISTA**.',
        '**👁 Previsualizar**: genera la lista y te la enseña antes de verla (miniatura, título, canal y duración). Quita con ✕ los que no te apetezcan, **🔀 Otra** genera otra distinta y **Descartar** la cierra. Con previsualización, el botón pasa a «VER ESTA LISTA».',
        'Mientras trabaja verás un **spinner y una barra de progreso**.'],
    ],
  },
  {
    id: 'picoteo', title: 'Modo TV: picoteo', icon: 'reloj', blocks: [
      'En vez de vídeos enteros, reproduce solo el **trozo más visto** de cada uno (según la curva de «lo más visto» de YouTube) y salta solo al siguiente. Eliges el tamaño del trozo: de 30 s a 3 min.',
      ['ul',
        'Sobre el reproductor aparece «🍿 Picoteo 3/12 · siguiente en 0:42» con **Ver entero** (sigue viendo ese vídeo completo), **⏭** (saltar) y **✕** (salir del picoteo).',
        'Si un vídeo no tiene curva de «lo más visto», se reproduce un trozo a partir del 30 %.'],
    ],
  },
  {
    id: 'descubrir', title: 'Descubrir', icon: 'brujula', blocks: [
      'Sugiere **canales parecidos a los tuyos que aún no tienes** en YTBox: mira los vídeos relacionados de los últimos vídeos de tus canales y cuenta qué otros canales aparecen más (pesa más si salen con varios de tus canales distintos).',
      ['ul',
        'Elige grupos (con **Marcar todos / Desmarcar todos** para elegirlos todos de golpe) o canales sueltos (con chips para quitarlos) y pulsa **✦ Descubrir**. Cada vez sale una tanda distinta.',
        'Cada sugerencia dice a qué canales tuyos se parece y enseña dos de sus vídeos. Pulsa su nombre para abrir el canal.',
        '**+ Añadir a grupo** lo mete en el grupo que elijas; **No me interesa** hace que no vuelva a salir.'],
      ['tip', 'Úsalo **desde YouTube** (sección YTBox → Descubrir). Desde el gestor YouTube suele rechazar las consultas («YouTube respondió 403»); si tienes YouTube abierto en otra pestaña, el gestor la usa para hacerlas y sí funciona. El aviso de la página del gestor tiene un botón para abrir Descubrir directamente en YouTube.'],
    ],
  },
  {
    id: 'avisos', title: 'Avisos de canales', icon: 'ojoTachado', blocks: [
      'En la fila de canales de cada grupo (y en la lista de canales del gestor) algunos canales llevan un icono. No se borra nada: es solo un aviso. Pasa el ratón para ver el detalle.',
      ['ul',
        '**Zzz gris**: lleva más de 3 meses sin subir vídeos.',
        '**Ojo tachado naranja**: hace tiempo que no lo ves; te has saltado al menos sus 4 últimos vídeos y el más antiguo tiene más de 3 semanas. Usa tu historial de YouTube (con sesión) y lo que YTBox ve que abres.'],
    ],
  },
  {
    id: 'suscripciones', title: 'Página de Suscripciones de YouTube', icon: 'campana', blocks: [
      'En youtube.com/feed/subscriptions aparece una barra de YTBox encima de los vídeos para **filtrar por grupo** y **ocultar los vídeos ya vistos**.',
    ],
  },
  {
    id: 'gestor', title: 'El gestor', icon: 'grupo', blocks: [
      ['ul',
        '**Grupos** (columna izquierda): pulsa uno para editarlo. Los canales se pueden **ordenar**: alfabético, más suscriptores, último vídeo subido o los que más ves; y **filtrar**: todos, los que llevan mucho sin subir contenido o los que hace tiempo que no ves (mismo criterio que los avisos de canal). Debajo de cada canal sale el dato usado y el orden se guarda en el grupo.',
        '**Todos los canales**: todos los canales guardados con sus grupos.',
        '**Modo TV**, **Descubrir** y **Calendario**: igual que en YouTube (el calendario del gestor junta todos los grupos).',
        '**Ayuda**: esta página.'],
    ],
  },
  {
    id: 'ajustes', title: 'Ajustes', icon: 'engranaje', blocks: [
      ['ul',
        '**Opciones de portada**: activar o desactivar el **estante de YTBox** en la portada de YouTube (activado por defecto), **Mostrar solo los grupos con vídeos nuevos** en el panel lateral (desactivado por defecto) y **Previsualizar nuevos en menú**: al pasar el ratón por un grupo con vídeos nuevos se ven esos vídeos en un panel a su derecha (desactivado por defecto).',
        '**Apariencia**: tema claro, oscuro o automático (sigue el de YouTube o el del sistema), y los dos colores del degradado de la app.',
        '**Idioma**: español, inglés o gallego. Cambia todos los textos de YTBox, en el gestor y dentro de YouTube.',
        '**Apoya YTBox** (a la derecha de los ajustes, o al final si la ventana es estrecha): enlace a Ko-fi (ko-fi.com/dani9del9) por si quieres invitar a un café al autor.',
        '**Sincronizar entre navegadores**: guarda grupos y canales en tu cuenta del navegador (Chrome o Edge con sincronización activada).',
        '**Copia de seguridad**: exporta o importa un JSON con **toda la configuración**: grupos, iconos, canales, preconfiguraciones del Modo TV, idioma, tema, colores y opciones. Al importar puedes combinar con lo que tienes o reemplazarlo todo; los ajustes del archivo se aplican en los dos casos.',
        '**Importar desde PocketTube**: elige la copia de seguridad exportada desde PocketTube (.json o .txt). Los grupos con el mismo nombre se combinan.',
        '**Importar suscripciones de YouTube**: abre youtube.com/feed/channels y pulsa «Importar todas mis suscripciones».',
        '**Borrar todo**: elimina todos los grupos y canales.'],
    ],
  },
  {
    id: 'datos', title: 'Datos, sesión y limitaciones', icon: 'escudo', blocks: [
      ['ul',
        'Todo se guarda **en tu navegador** (y en tu cuenta del navegador si activas la sincronización). YTBox no tiene servidor propio.',
        'Los vídeos de cada canal salen del **RSS de YouTube**: los **15 últimos** por canal. Las duraciones, «lo más visto» y los relacionados se piden a YouTube aparte.',
        'Con la **sesión de YouTube iniciada** funcionan Ver más tarde, playlists, la lista con nombre del Modo TV y el historial para los avisos.',
        'Los nombres de canales guardados solo con su código (UC…) se completan solos en segundo plano.',
        'Las consultas a YouTube que hace el **gestor** (Descubrir, Modo TV, suscriptores) se hacen a través de una pestaña de YouTube abierta si la hay; si YouTube las frena por exceso de peticiones, YTBox espera y reintenta.',
        'Hay versión para **Chrome/Edge** y para **Firefox**.'],
    ],
  },
];
