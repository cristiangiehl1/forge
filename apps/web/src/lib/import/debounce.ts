/** Runs `fn` once, with the last arguments, after `delay` ms without a new call. */
export function debounce<A extends unknown[]>(
  delay: number,
  fn: (...args: A) => void
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    run(...args: A): void {
      clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        fn(...args)
      }, delay)
    },
    cancel(): void {
      clearTimeout(timer)
      timer = undefined
    },
  }
}
