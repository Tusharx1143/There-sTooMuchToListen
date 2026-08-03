const canvas = document.querySelector<HTMLCanvasElement>('#atlas')
if (!canvas) throw new Error('missing #atlas canvas')
canvas.width = window.innerWidth
canvas.height = window.innerHeight
