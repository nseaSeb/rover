defmodule Rover.Mapping do
  @moduledoc false
  # The field-mapping check shared by `Rover.Marker`, `Rover.Shape` and
  # `Rover.Heatmap`.
  #
  # All three take a keyword list mapping a Rover field onto a key or an
  # accessor of the caller's own rows, and all three read it with
  # `Keyword.fetch/2` per field — so a field that was never mapped falls back to
  # its default keys, and a name Rover does not have is read by nobody. Left
  # unchecked that is a typo which renders a map as if nothing had been said,
  # and a mapping written backwards (a bare list of keys) which does the same.

  @doc """
  Raises unless `opts` is a keyword list naming only `fields`.

  `noun` names the thing being built and `example` shows a correct mapping; both
  go into the error, because the mistake is always in the caller's template.
  """
  @spec validate!(term(), [atom()], String.t(), String.t()) :: :ok
  def validate!(opts, fields, noun, example) when is_list(opts) do
    Enum.each(opts, fn
      {field, _accessor} when is_atom(field) ->
        field in fields ||
          raise ArgumentError, """
          unknown #{noun} field #{inspect(field)} in the field mapping.

          Expected any of: #{Enum.map_join(fields, ", ", &inspect/1)}.
          """

      other ->
        raise ArgumentError, """
        expected the #{noun} field mapping to be a keyword list, got #{inspect(other)} in #{inspect(opts)}.

        A mapping goes from a Rover field to your key or accessor:

            #{example}
        """
    end)
  end

  def validate!(other, _fields, noun, _example) do
    raise ArgumentError,
          "expected the #{noun} field mapping to be a keyword list, got: #{inspect(other)}"
  end
end
