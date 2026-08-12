export function createIlikeFilterValue(value) {
  const escapedValue = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[%*]/g, '')
    .trim()

  return escapedValue
    ? `"*${escapedValue}*"`
    : null
}

function getVisiblePages(currentPage, totalPages) {
  const firstPage = Math.max(
    1,
    Math.min(currentPage - 2, totalPages - 4)
  )
  const lastPage = Math.min(totalPages, firstPage + 4)

  return Array.from(
    { length: lastPage - firstPage + 1 },
    (_, index) => firstPage + index
  )
}

function createPageButton({
  label,
  page,
  currentPage,
  disabled = false,
  onPageChange
}) {
  const button = document.createElement('button')
  button.className = 'pagination-button'
  button.type = 'button'
  button.textContent = label
  button.disabled = disabled

  if (page === currentPage) {
    button.classList.add('is-current')
    button.setAttribute('aria-current', 'page')
  }

  button.addEventListener('click', () => {
    onPageChange(page)
  })

  return button
}

export function renderPagination({
  container,
  currentPage,
  totalCount,
  pageSize,
  onPageChange
}) {
  container.replaceChildren()

  const totalPages = Math.ceil(totalCount / pageSize)

  if (totalPages <= 1) {
    container.hidden = true
    return
  }

  container.hidden = false
  container.append(
    createPageButton({
      label: '이전',
      page: currentPage - 1,
      currentPage,
      disabled: currentPage === 1,
      onPageChange
    })
  )

  getVisiblePages(currentPage, totalPages).forEach((page) => {
    container.append(
      createPageButton({
        label: String(page),
        page,
        currentPage,
        onPageChange
      })
    )
  })

  container.append(
    createPageButton({
      label: '다음',
      page: currentPage + 1,
      currentPage,
      disabled: currentPage === totalPages,
      onPageChange
    })
  )
}
