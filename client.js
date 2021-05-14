/* eslint-env browser */
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', event => {
    const target = event.target
    if (target.tagName !== 'BUTTON') return
    if (target.className === 'markRead') markRead(event)
    if (target.className === 'delete') deletePost(event)
  })
})

function deletePost (event) {
  const target = event.target
  const innerText = target.innerText
  if (innerText === 'Confirm') {
    // Disable the button.
    target.disabled = true
    // Find the URL of the post.
    const postURL = target.dataset.url
    const endpoint = new URL(window.location.href)
    endpoint.searchParams.append('action', 'delete')
    endpoint.searchParams.append('url', postURL)
    // Send POST.
    fetch(endpoint, { method: 'POST' })
      .then(response => {
        if (response.status === 200) {
          target.parentNode.className = 'deleted'
        } else {
          window.alert('error deleting')
        }
      })
  } else {
    target.innerText = 'Confirm'
  }
}

function markRead (event) {
  const target = event.target
  // Disable the button.
  target.disabled = true
  // Find the URL of the post.
  const postURL = target.dataset.url
  const endpoint = new URL(window.location.href)
  endpoint.searchParams.append('action', 'read')
  endpoint.searchParams.append('url', postURL)
  // Send POST.
  fetch(endpoint, { method: 'POST' })
    .then(response => {
      if (response.status === 200) {
        target.parentNode.className = 'read'
      } else {
        window.alert('error marking read')
      }
    })
}
