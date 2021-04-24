document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', event => {
    const target = event.target
    if (target.tagName !== 'BUTTON') return
    const postURL = target.dataset.url
    const endpoint = new URL('/')
    endpoint.searchParams.append('url', postURL)
    fetch(endpoint, { method: 'POST' })
      .then(response => {
        if (response.status === 200) {
          const li = target.parentNode
          li.parentNode.removeChild(li)
        } else {
          window.alert('error marking read')
        }
      })
  })
})
