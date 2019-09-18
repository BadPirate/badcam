import React from 'react'

export function FolderComponent(folder) {
  if (folder[".tag"] != "folder") return null
  let regex = /(\d\d\d\d)-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)/
  let nameParts = regex.exec(folder.name)
  if (nameParts.length < 7) return null
  let [_, year, month, day, hour, minute, second] = nameParts
  return (
    <tr>
      <td>{`${year}-${month}-${day}`}</td>
      <td>{`${hour}:${minute}.${second}`}</td>
      <td>{JSON.stringify(folder)}</td>
    </tr>
  );
}
