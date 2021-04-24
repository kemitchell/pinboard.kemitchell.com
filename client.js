/* eslint-env browser */
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', event => {
    const target = event.target
    if (target.tagName !== 'BUTTON') return
    // Find the URL of the post.
    const postURL = target.dataset.url
    const endpoint = new URL('/')
    endpoint.searchParams.append('url', postURL)
    // Send POST.
    fetch(endpoint, { method: 'POST' })
      .then(response => {
        if (response.status === 200) {
          // Remove list item for read post.
          const li = target.parentNode
          li.parentNode.removeChild(li)
        } else {
          window.alert('error marking read')
        }
      })
  })
})
