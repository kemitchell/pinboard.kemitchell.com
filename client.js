/* eslint-env browser */
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', event => {
    const target = event.target
    if (target.tagName !== 'BUTTON') return
    if (target.className !== 'markRead') return
    // Disable the button.
    target.disabled = true
    // Find the URL of the post.
    const postURL = target.dataset.url
    const endpoint = new URL(window.location.href)
    endpoint.searchParams.append('url', postURL)
    // Send POST.
    fetch(endpoint, { method: 'POST' })
      .then(response => {
        if (response.status === 200) {
          const li = target.parentNode.className = 'read'
        } else {
          window.alert('error marking read')
        }
      })
  })
})
